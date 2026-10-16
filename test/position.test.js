import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosition, configApy, resolveDepositPeriod } from '../src/logic/position.ts';

const entry = {
  id: 'APC3M', entryNavBaseline: 1.0, apyFallback: 0.14,
  actionPeriodConfig: {
    lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
    actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00', withdrawable: '2026-10-20',
  },
};
const ap = { source: 'config', start: null, end: null, startTs: null, endTs: null, withdrawableDate: '2026-10-20', isOpen: false, opensInDays: null, closesInDays: null, stale: false };

test('computes current value, principal, realized yield', () => {
  const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);
  const p = computePosition({ entry, sharesHuman: '100', nav: 1.03, apy: 0.14, actionPeriod: ap, now });
  assert.equal(p.currentValue, 103);
  assert.equal(p.principal, 100);
  assert.ok(Math.abs(p.realizedYield - 3) < 1e-9);
  assert.equal(p.estimated, true);
  assert.equal(p.assumptions.entryNav, 1.0);
  assert.equal(p.depositedDurationDays, 7);
  assert.ok(p.expectedTotalYield > 0);
});

test('expectedTotalYield projects earned-to-date forward to lock end', () => {
  const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);
  const p = computePosition({ entry, sharesHuman: '100', nav: 1.03, apy: 0.14, actionPeriod: ap, now });
  const yearsLeft = (Date.parse('2026-10-20T23:59:59+08:00') - Date.parse('2026-07-27T00:00:00+08:00')) / 1000 / 31557600;
  assert.ok(Math.abs(p.expectedTotalYield - (3 + 103 * 0.14 * yearsLeft)) < 1e-6);
  // Never below what the position has already earned.
  assert.ok(p.expectedTotalYield > p.realizedYield);
  assert.equal(p.assumptions.expectedYieldBasis, 'earned-to-date + apy x time-to-lock-end');
});

test('after lock end there is no time left to project — expected == earned', () => {
  const now = Math.floor(Date.parse('2026-11-01T00:00:00+08:00') / 1000);
  const p = computePosition({ entry, sharesHuman: '100', nav: 1.03, apy: 0.14, actionPeriod: ap, now });
  assert.ok(Math.abs(p.expectedTotalYield - p.realizedYield) < 1e-9);
});

test('no NAV → projection falls back to principal, still reported', () => {
  const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);
  const p = computePosition({ entry, sharesHuman: '100', nav: null, apy: 0.14, actionPeriod: ap, now });
  const yearsLeft = (Date.parse('2026-10-20T23:59:59+08:00') - Date.parse('2026-07-27T00:00:00+08:00')) / 1000 / 31557600;
  assert.ok(Math.abs(p.expectedTotalYield - 100 * 0.14 * yearsLeft) < 1e-6);
});

test('null nav → null value/yield but principal still set', () => {
  const p = computePosition({ entry, sharesHuman: '50', nav: null, apy: null, actionPeriod: ap, now: Math.floor(Date.parse('2026-07-27T00:00:00+08:00')/1000) });
  assert.equal(p.currentValue, null);
  assert.equal(p.realizedYield, null);
  assert.equal(p.principal, 50);
});

test('computePosition records navResolvedFrom in assumptions', () => {
  const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);
  const p = computePosition({ entry, sharesHuman: '100', nav: 1.03, apy: 0.14, actionPeriod: ap, now, navResolvedFrom: 'onchain' });
  assert.equal(p.assumptions.navResolvedFrom, 'onchain');
});
test('computePosition navResolvedFrom defaults to onchain', () => {
  const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);
  const p = computePosition({ entry, sharesHuman: '100', nav: 1.03, apy: 0.14, actionPeriod: ap, now });
  assert.equal(p.assumptions.navResolvedFrom, 'onchain');
});

test('resolveDepositPeriod: one window (Pre + Extend), phase per segment', () => {
  const e = { apyFallback: 0.14, depositPeriodConfig: {
    preStart: '2026-10-13T00:00:00+08:00', preEnd: '2026-10-20T15:00:00+08:00', extendEnd: '2026-10-27T09:00:00+08:00',
    pre: { grossApy: 0.13, performanceFeeRate: 0, netApy: 0.13 },
    extend: { grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
  } };
  const at = (iso) => resolveDepositPeriod(e, Math.floor(Date.parse(iso) / 1000));
  assert.equal(at('2026-10-12T00:00:00+08:00').phase, 'upcoming');
  assert.equal(at('2026-10-12T00:00:00+08:00').isOpen, false);
  assert.equal(at('2026-10-16T00:00:00+08:00').phase, 'pre');
  assert.equal(at('2026-10-20T15:00:00+08:00').phase, 'extend');
  assert.equal(at('2026-10-20T15:00:00+08:00').isOpen, true);
  assert.equal(at('2026-10-27T09:00:00+08:00').phase, 'closed');
  const dp = at('2026-10-16T00:00:00+08:00');
  assert.equal(dp.start, '2026-10-13T00:00:00+08:00');
  assert.equal(dp.end, '2026-10-27T09:00:00+08:00');
  assert.deepEqual(dp.segments.map((s) => [s.phase, s.netApy, s.performanceFeeRate]), [['pre', 0.13, 0], ['extend', 0.125, 0.1]]);
  assert.equal(resolveDepositPeriod({}, 0), null);
});

test('configApy: Pre net APY before preEnd, Extend net APY after (rest of lock too)', () => {
  const e = { apyFallback: 0.14, depositPeriodConfig: {
    preStart: '2026-10-13T00:00:00+08:00', preEnd: '2026-10-20T15:00:00+08:00', extendEnd: '2026-10-27T09:00:00+08:00',
    pre: { grossApy: 0.13, performanceFeeRate: 0, netApy: 0.13 },
    extend: { grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
  } };
  const sec = (iso) => Math.floor(Date.parse(iso) / 1000);
  assert.equal(configApy(e, sec('2026-10-16T00:00:00+08:00')), 0.13);
  assert.equal(configApy(e, sec('2026-10-22T00:00:00+08:00')), 0.125);
  assert.equal(configApy(e, sec('2026-12-01T00:00:00+08:00')), 0.125);
  assert.equal(configApy({ apyFallback: 0.14 }, 0), 0.14);
});

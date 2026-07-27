import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosition } from '../src/logic/position.ts';

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

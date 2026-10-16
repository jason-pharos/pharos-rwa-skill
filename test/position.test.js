import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosition } from '../src/logic/position.ts';

const S1 = {
  id: 'apc-s1', label: 'Season 1',
  lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
  actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00',
  withdrawable: '2026-10-20T23:59:59+08:00',
  terms: [{ from: '2026-07-20T00:00:00+08:00', label: 'Season 1', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
};
const entry = { id: 'APC3M', entryNavBaseline: 1.0, apyFallback: 0.14, epochs: [S1] };
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

test('no live epoch (past withdrawable) → no lock data, no projection', () => {
  const now = Math.floor(Date.parse('2026-11-01T00:00:00+08:00') / 1000);
  const p = computePosition({ entry, sharesHuman: '100', nav: 1.03, apy: 0.14, actionPeriod: ap, now });
  assert.equal(p.lockEnd, null);
  assert.equal(p.depositedDurationDays, null);
  assert.equal(p.expectedTotalYield, null);
  assert.deepEqual(p.epochs, []);
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

test('overlapping epochs: current drives lock timing, all live epochs attached', () => {
  const S2 = {
    id: 'apc-s2', label: 'Season 2',
    deposit: { start: '2026-10-13T00:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
    lockStart: '2026-10-20T15:00:00+08:00', lockEnd: '2027-01-21T15:00:00+08:00',
    actionStart: '2026-10-13T00:00:00+08:00', actionEnd: '2027-01-13T00:00:00+08:00',
    withdrawable: '2027-01-21T15:00:00+08:00',
    terms: [{ from: '2026-10-13T00:00:00+08:00', label: 'Deposit Period (Pre)', grossApy: 0.13, performanceFeeRate: 0, netApy: 0.13 }],
  };
  const now = Math.floor(Date.parse('2026-10-16T00:00:00+08:00') / 1000);
  const p = computePosition({ entry: { ...entry, epochs: [S2, S1] }, sharesHuman: '100', nav: 1.03, apy: null, actionPeriod: ap, now });
  assert.equal(p.lockEnd, '2026-10-20T23:59:59+08:00');
  assert.deepEqual(p.epochs.map((e) => [e.id, e.role]), [['apc-s1', 'current'], ['apc-s2', 'next']]);
  // apy null → current epoch's net APY (S1: 0.14)
  const yearsLeft = (Date.parse('2026-10-20T23:59:59+08:00') - Date.parse('2026-10-16T00:00:00+08:00')) / 1000 / 31557600;
  assert.ok(Math.abs(p.expectedTotalYield - (3 + 103 * 0.14 * yearsLeft)) < 1e-6);
});

test('vault without epochs → no epochs field', () => {
  const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);
  const p = computePosition({ entry: { id: 'VRPC-Weekly', entryNavBaseline: 1, apyFallback: 0.1 }, sharesHuman: '1', nav: 1, apy: 0.1, actionPeriod: ap, now });
  assert.equal(p.epochs, undefined);
  assert.equal(p.lockEnd, null);
});

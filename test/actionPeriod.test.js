import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActionPeriod, resolveRedeemableActionPeriod } from '../src/logic/actionPeriod.ts';

const apc = {
  id: 'APC3M',
  actionPeriodConfig: {
    lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
    actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00',
    withdrawable: '2026-10-20',
  },
};
// pALPHA uses config for action period, same as APC3M (the vault-info API is
// no longer used at all).
const pa = {
  id: 'pALPHA',
  actionPeriodConfig: {
    lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-01T00:00:00+08:00',
    actionStart: '2026-09-17T11:00:00+08:00', actionEnd: '2026-10-01T00:00:00+08:00',
    withdrawable: '2026-10-01',
  },
};

test('APC3M uses config (open within window)', () => {
  const now = Math.floor(Date.parse('2026-08-01T00:00:00+08:00') / 1000);
  const ap = resolveActionPeriod(apc, now);
  assert.equal(ap.source, 'config');
  assert.equal(ap.isOpen, true); // 08-01 within 07-20..10-16
});

test('pALPHA uses config, NOT the API phases (regression: was showing stale 07-20)', () => {
  // now = 2026-07-28 (real repro date). Config window opens 2026-09-17.
  const now = Math.floor(Date.parse('2026-07-28T00:00:00+08:00') / 1000);
  const ap = resolveActionPeriod(pa, now);
  assert.equal(ap.source, 'config');
  assert.equal(ap.startTs, Math.floor(Date.parse('2026-09-17T11:00:00+08:00') / 1000));
  assert.equal(ap.isOpen, false);
  assert.equal(ap.stale, false); // must NOT be stale — window is in the future
  assert.ok(ap.opensInDays > 0);
});

test('pALPHA open during its configured window', () => {
  const now = Math.floor(Date.parse('2026-09-20T00:00:00+08:00') / 1000);
  const ap = resolveActionPeriod(pa, now);
  assert.equal(ap.source, 'config');
  assert.equal(ap.isOpen, true); // 09-20 within 09-17..10-01
});

test('unavailable when config unparseable', () => {
  const broken = { id: 'APC3M', actionPeriodConfig: { actionStart: 'nope', actionEnd: 'nope', withdrawable: 'nope', lockStart: 'x', lockEnd: 'x' } };
  const ap = resolveActionPeriod(broken, 1000);
  assert.equal(ap.source, 'unavailable');
  assert.equal(ap.startTs, null);
});

test('redeemable action period: partly redeemable → isOpen, not stale', () => {
  const raw = { maxRedeemShares: 12976.25, pendingRedeemShares: 0, claimableRedeemShares: 0 };
  const ap = resolveRedeemableActionPeriod(raw, 57656.24, 1.0283);
  assert.equal(ap.source, 'onchain-redeemable');
  assert.equal(ap.isOpen, true);
  assert.equal(ap.stale, false);
  assert.equal(ap.redeemable.maxRedeemShares, 12976.25);
  assert.ok(Math.abs(ap.redeemable.maxRedeemValue - 12976.25 * 1.0283) < 1e-6);
  assert.equal(ap.redeemable.fullyRedeemable, false); // 12976 < 57656
});

test('redeemable action period: nothing redeemable → not open, locked', () => {
  const raw = { maxRedeemShares: 0, pendingRedeemShares: 0, claimableRedeemShares: 0 };
  const ap = resolveRedeemableActionPeriod(raw, 100, 1.0);
  assert.equal(ap.isOpen, false);
  assert.equal(ap.redeemable.fullyRedeemable, false);
  assert.equal(ap.redeemable.maxRedeemValue, 0);
});

test('redeemable action period: fully redeemable when maxRedeem >= held', () => {
  const raw = { maxRedeemShares: 100, pendingRedeemShares: 0, claimableRedeemShares: 0 };
  const ap = resolveRedeemableActionPeriod(raw, 100, 1.0);
  assert.equal(ap.redeemable.fullyRedeemable, true);
  assert.equal(ap.isOpen, true);
});

test('redeemable action period: null nav → null maxRedeemValue', () => {
  const raw = { maxRedeemShares: 50, pendingRedeemShares: 0, claimableRedeemShares: 0 };
  const ap = resolveRedeemableActionPeriod(raw, 50, null);
  assert.equal(ap.redeemable.maxRedeemValue, null);
  assert.equal(ap.isOpen, true);
});

test('redeemable: escrowed shares (pending) count toward total position + keep isOpen', () => {
  // wallet drained to 0 by requestRedeem; 500 shares pending settlement.
  const raw = { maxRedeemShares: 0, pendingRedeemShares: 500, claimableRedeemShares: 0 };
  const ap = resolveRedeemableActionPeriod(raw, 0, 1.0);
  assert.equal(ap.isOpen, true); // pending in flight → still "open"/active
  assert.equal(ap.redeemable.pendingRedeemShares, 500);
  // fullyRedeemable compares maxRedeem(0) against total position(500) → false
  assert.equal(ap.redeemable.fullyRedeemable, false);
});

test('redeemable: fullyRedeemable uses wallet+escrowed as denominator', () => {
  // 60 in wallet, 40 claimable already; maxRedeem 60 == wallet, but total is 100.
  const raw = { maxRedeemShares: 60, pendingRedeemShares: 0, claimableRedeemShares: 40 };
  const ap = resolveRedeemableActionPeriod(raw, 60, 1.0);
  assert.equal(ap.redeemable.fullyRedeemable, false); // 60 < 100 total
  // claimable present → still open
  assert.equal(ap.isOpen, true);
});

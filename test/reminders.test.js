import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminders } from '../src/logic/reminders.ts';

const mk = (vault, ap) => ({ vault, shares: '1', nav: 1, currentValue: 1, estimated: true, assumptions: {}, principal: 1, realizedYield: 0, depositedDurationDays: 1, lockEnd: '', expectedTotalYield: 0, actionPeriod: ap });

test('open and closing soon', () => {
  const r = buildReminders([mk('APC3M', { source: 'config', isOpen: true, opensInDays: null, closesInDays: 3, stale: false })]);
  assert.equal(r[0].urgency, 'closing-soon');
});
test('opening soon', () => {
  const r = buildReminders([mk('pALPHA', { source: 'api', isOpen: false, opensInDays: 5, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'opening-soon');
});
test('future', () => {
  const r = buildReminders([mk('pALPHA', { source: 'api', isOpen: false, opensInDays: 40, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'future');
});
test('unavailable → unknown', () => {
  const r = buildReminders([mk('APC3M', { source: 'unavailable', isOpen: false, opensInDays: null, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'unknown');
});

const mkRedeemable = (r) => ({
  vault: 'VRPC-SemiYearly', shares: '1', nav: 1, currentValue: 1, estimated: true, assumptions: {},
  principal: 1, realizedYield: 0, depositedDurationDays: null, lockEnd: null, expectedTotalYield: null,
  actionPeriod: { start: null, end: null, startTs: null, endTs: null, withdrawableDate: null, source: 'onchain-redeemable', isOpen: r.maxRedeemShares>0||r.claimableRedeemShares>0, opensInDays: null, closesInDays: null, stale: false, redeemable: r },
});

test('redeemable reminder: claimable takes priority', () => {
  const [rem] = buildReminders([mkRedeemable({ maxRedeemShares: 100, pendingRedeemShares: 0, claimableRedeemShares: 30, maxRedeemValue: 100, fullyRedeemable: false })]);
  assert.equal(rem.urgency, 'claimable');
  assert.match(rem.message, /claim/i);
});

test('redeemable reminder: some redeemable now', () => {
  const [rem] = buildReminders([mkRedeemable({ maxRedeemShares: 12976, pendingRedeemShares: 0, claimableRedeemShares: 0, maxRedeemValue: 13000, fullyRedeemable: false })]);
  assert.equal(rem.urgency, 'redeemable');
  assert.match(rem.message, /redeemable now/i);
});

test('redeemable reminder: locked when nothing redeemable', () => {
  const [rem] = buildReminders([mkRedeemable({ maxRedeemShares: 0, pendingRedeemShares: 0, claimableRedeemShares: 0, maxRedeemValue: 0, fullyRedeemable: false })]);
  assert.equal(rem.urgency, 'locked');
  assert.match(rem.message, /184/);
});

test('redeemable reminder: pending-only → pending urgency (already requested)', () => {
  const [rem] = buildReminders([mkRedeemable({ maxRedeemShares: 0, pendingRedeemShares: 500, claimableRedeemShares: 0, maxRedeemValue: 0, fullyRedeemable: false })]);
  assert.equal(rem.urgency, 'pending');
  assert.match(rem.message, /awaiting settlement/i);
});

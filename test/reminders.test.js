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
  actionPeriod: { start: null, end: null, startTs: null, endTs: null, withdrawableDate: null, source: 'onchain-redeemable', isOpen: r.maxRedeemShares>0||r.claimableRedeemShares>0||r.pendingRedeemShares>0, opensInDays: null, closesInDays: null, stale: false, redeemable: { lockDays: 184, async: true, ...r } },
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

test('redeemable reminder: locked message uses lockDays (184 for SemiYearly)', () => {
  const [rem] = buildReminders([mkRedeemable({ maxRedeemShares: 0, pendingRedeemShares: 0, claimableRedeemShares: 0, maxRedeemValue: 0, fullyRedeemable: false, lockDays: 184 })]);
  assert.equal(rem.urgency, 'locked');
  assert.match(rem.message, /184 days/);
});

test('redeemable reminder: Weekly locked message uses 7-day lock', () => {
  const [rem] = buildReminders([mkRedeemable({ maxRedeemShares: 0, pendingRedeemShares: 0, claimableRedeemShares: 0, maxRedeemValue: 0, fullyRedeemable: false, lockDays: 7 })]);
  assert.equal(rem.urgency, 'locked');
  assert.match(rem.message, /7 days/);
  assert.doesNotMatch(rem.message, /184/);
});

test('redeemable reminder: pending-only → pending urgency (already requested)', () => {
  const [rem] = buildReminders([mkRedeemable({ maxRedeemShares: 0, pendingRedeemShares: 500, claimableRedeemShares: 0, maxRedeemValue: 0, fullyRedeemable: false })]);
  assert.equal(rem.urgency, 'pending');
  assert.match(rem.message, /awaiting settlement/i);
});

test('locked wording: async (SemiYearly) adds request-ahead note; sync (Weekly) does not', () => {
  const [asyncRem] = buildReminders([mkRedeemable({ maxRedeemShares: 0, pendingRedeemShares: 0, claimableRedeemShares: 0, maxRedeemValue: 0, fullyRedeemable: false, lockDays: 184, async: true })]);
  assert.match(asyncRem.message, /request/i);
  const [syncRem] = buildReminders([mkRedeemable({ maxRedeemShares: 0, pendingRedeemShares: 0, claimableRedeemShares: 0, maxRedeemValue: 0, fullyRedeemable: false, lockDays: 7, async: false })]);
  assert.doesNotMatch(syncRem.message, /request/i);
  assert.match(syncRem.message, /7 days/);
});

const apCfg = (o) => ({ source: 'config', start: null, end: null, startTs: null, endTs: null, withdrawableDate: null, isOpen: false, opensInDays: null, closesInDays: null, stale: false, ...o });
const P3_TERMS = { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period', grossApy: 0.138, performanceFeeRate: 0, netApy: 0.138 };
const view = (o) => ({
  id: 'palpha-p3', label: 'Phase 3', role: 'next', status: 'deposit-open',
  deposit: { start: '2026-10-20T15:00:00+08:00', end: '2026-10-27T09:00:00+08:00', isOpen: true },
  lockStart: '2026-10-20T15:00:00+08:00', lockEnd: '2027-01-21T15:00:00+08:00',
  actionPeriod: apCfg({ opensInDays: 59 }), withdrawable: '2027-01-21T15:00:00+08:00',
  currentTerms: P3_TERMS, terms: [P3_TERMS], ...o,
});

test('epoch-based position: one reminder per live epoch', () => {
  const current = view({
    id: 'palpha-p2', label: 'Phase 2', role: 'current', status: 'locked', deposit: null,
    withdrawable: '2026-10-20T19:00:00+08:00', actionPeriod: apCfg({ stale: true }),
    currentTerms: null, terms: [],
  });
  const p = { ...mk('pALPHA', apCfg({ stale: true })), epochs: [current, view({})] };
  const r = buildReminders([p]);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => [x.epoch, x.urgency]), [['palpha-p2', 'closed'], ['palpha-p3', 'future']]);
  assert.match(r[0].message, /^pALPHA Phase 2: withdraw window for this epoch has closed; holdings roll over into the next epoch after Oct 20, 19:00 UTC\+8\.$/);
  assert.match(r[1].message, /^pALPHA Phase 3: withdraw window opens in 59 day\(s\)\. Deposit open until Oct 27, 09:00 UTC\+8 \(Deposit Period net APY 13\.8%\)\.$/);
});

test('each epoch reminder uses that epoch\'s own action period (R25 attached to its epoch)', () => {
  const r25 = apCfg({ source: 'r25-api', isOpen: true, closesInDays: 89 });
  const s1 = view({ id: 'apc-s1', label: 'Season 1', role: 'current', status: 'locked', deposit: null, withdrawable: '2026-10-20T23:59:59+08:00', actionPeriod: apCfg({ stale: true }) });
  const s2 = view({ id: 'apc-s2', label: 'Season 2', role: 'next', deposit: null, actionPeriod: r25 });
  const p = { ...mk('APC3M', s1.actionPeriod), epochs: [s1, s2] };
  const [r1, r2] = buildReminders([p]);
  assert.equal(r1.urgency, 'closed');
  assert.match(r1.message, /^APC3M Season 1: withdraw window for this epoch has closed; holdings roll over into the next epoch after Oct 20, 23:59 UTC\+8\.$/);
  assert.equal(r2.urgency, 'open');
  assert.equal(r2.actionPeriod, r25);
  assert.equal(r2.message, 'APC3M Season 2: withdraw window is open now.');
});

test('deposit suffix omitted without terms', () => {
  const p = { ...mk('pALPHA', apCfg({})), epochs: [view({ role: 'current', currentTerms: null, terms: [] })] };
  const [rem] = buildReminders([p]);
  assert.doesNotMatch(rem.message, /Deposit open/);
});

test('epoch-based position with no live epoch → single unknown reminder', () => {
  const p = { ...mk('APC3M', apCfg({ source: 'unavailable' })), epochs: [] };
  const r = buildReminders([p]);
  assert.equal(r.length, 1);
  assert.equal(r[0].urgency, 'unknown');
  assert.equal(r[0].message, 'APC3M: no active epoch configured; config may be stale.');
  assert.equal(r[0].epoch, undefined);
});

test('epoch-based position with no live epoch but an R25 action period → normal reminder', () => {
  const p = { ...mk('APC3M', apCfg({ source: 'r25-api', isOpen: true, closesInDays: 30 })), epochs: [] };
  const r = buildReminders([p]);
  assert.equal(r.length, 1);
  assert.equal(r[0].urgency, 'open');
  assert.equal(r[0].message, 'APC3M: withdraw window is open now.');
  assert.equal(r[0].actionPeriod.source, 'r25-api');
  assert.equal(r[0].epoch, undefined);
});

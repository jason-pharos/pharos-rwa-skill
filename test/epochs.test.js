import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEpochs, currentEpoch, epochApy, resolveActionPeriod, attachR25Period } from '../src/logic/epochs.ts';
import { buildActionPeriod } from '../src/logic/actionPeriod.ts';

const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

const APC = {
  id: 'APC3M', apyFallback: 0.14,
  epochs: [
    {
      id: 'apc-s1', label: 'Season 1',
      deposit: { start: '2026-07-15T16:00:00+08:00', end: '2026-07-19T23:59:00+08:00' },
      lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
      actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-12T00:00:00+08:00',
      withdrawable: '2026-10-20T23:59:59+08:00',
      terms: [{ from: '2026-07-15T16:00:00+08:00', label: 'Season 1', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
    },
    {
      id: 'apc-s2', label: 'Season 2',
      deposit: { start: '2026-10-13T00:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
      lockStart: '2026-10-20T15:00:00+08:00', lockEnd: '2027-01-21T15:00:00+08:00',
      actionStart: '2026-10-13T00:00:00+08:00', actionEnd: '2027-01-13T00:00:00+08:00',
      withdrawable: '2027-01-21T15:00:00+08:00',
      terms: [
        { from: '2026-10-13T00:00:00+08:00', label: 'Deposit Period (Pre)', grossApy: 0.13, performanceFeeRate: 0, netApy: 0.13 },
        { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period (Extend) & Lock', grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
      ],
    },
  ],
};

const PALPHA = {
  id: 'pALPHA', apyFallback: 0.14,
  epochs: [
    {
      id: 'palpha-p2', label: 'Phase 2',
      lockStart: '2026-07-20T19:00:00+08:00', lockEnd: '2026-10-20T19:00:00+08:00',
      actionStart: '2026-09-17T11:00:00+08:00', actionEnd: '2026-10-01T00:00:00+08:00',
      withdrawable: '2026-10-20T19:00:00+08:00',
      terms: [{ from: '2026-07-20T19:00:00+08:00', label: 'Phase 2', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
    },
    {
      id: 'palpha-p3', label: 'Phase 3',
      deposit: { start: '2026-10-20T15:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
      lockStart: '2026-10-20T15:00:00+08:00', lockEnd: '2027-01-21T15:00:00+08:00',
      actionStart: '2026-12-18T11:00:00+08:00', actionEnd: '2027-01-01T11:00:00+08:00',
      withdrawable: '2027-01-21T15:00:00+08:00',
      terms: [
        { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period', grossApy: 0.138, performanceFeeRate: 0, netApy: 0.138 },
        { from: '2026-10-27T09:00:00+08:00', label: 'Lock Period', grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
      ],
    },
  ],
};

const summary = (entry, iso) =>
  resolveEpochs(entry, sec(iso)).epochs.map((e) => [e.id, e.role, e.status, e.currentTerms?.netApy ?? null]);

test('APC: S1 + S2 overlap on 10-16, only S2 on 10-21, none after S2', () => {
  assert.deepEqual(summary(APC, '2026-10-16T00:00:00+08:00'), [
    ['apc-s1', 'current', 'locked', 0.14],
    ['apc-s2', 'next', 'deposit-open', 0.13],
  ]);
  assert.deepEqual(summary(APC, '2026-10-21T00:00:00+08:00'), [['apc-s2', 'current', 'deposit-open', 0.125]]);
  assert.deepEqual(summary(APC, '2027-02-01T00:00:00+08:00'), []);
});

test('pALPHA: P3 upcoming on 10-16, both live at 10-20 16:00, only P3 after', () => {
  assert.deepEqual(summary(PALPHA, '2026-10-16T00:00:00+08:00'), [
    ['palpha-p2', 'current', 'locked', 0.14],
    ['palpha-p3', 'next', 'upcoming', 0.138],
  ]);
  assert.deepEqual(summary(PALPHA, '2026-10-20T16:00:00+08:00'), [
    ['palpha-p2', 'current', 'locked', 0.14],
    ['palpha-p3', 'next', 'deposit-open', 0.138],
  ]);
  assert.deepEqual(summary(PALPHA, '2026-10-28T00:00:00+08:00'), [['palpha-p3', 'current', 'locked', 0.125]]);
});

test('terms tier switches: APC S2 at 10-20 15:00, pALPHA P3 at 10-27 09:00', () => {
  const s2 = (iso) => resolveEpochs(APC, sec(iso)).epochs.find((e) => e.id === 'apc-s2').currentTerms;
  assert.equal(s2('2026-10-20T14:59:59+08:00').netApy, 0.13);
  assert.equal(s2('2026-10-20T15:00:00+08:00').netApy, 0.125);
  assert.equal(s2('2026-10-20T15:00:00+08:00').performanceFeeRate, 0.1);
  const p3 = (iso) => resolveEpochs(PALPHA, sec(iso)).epochs.find((e) => e.id === 'palpha-p3').currentTerms;
  assert.equal(p3('2026-10-27T08:59:59+08:00').netApy, 0.138);
  assert.equal(p3('2026-10-27T09:00:00+08:00').netApy, 0.125);
});

test('boundaries are half-open', () => {
  // dropped exactly at withdrawable
  assert.deepEqual(summary(PALPHA, '2026-10-20T19:00:00+08:00').map((r) => r[0]), ['palpha-p3']);
  // deposit closed exactly at deposit.end
  const p3 = resolveEpochs(PALPHA, sec('2026-10-27T09:00:00+08:00')).epochs[0];
  assert.equal(p3.status, 'locked');
  assert.equal(p3.deposit.isOpen, false);
  // deposit open exactly at deposit.start
  const p3open = resolveEpochs(PALPHA, sec('2026-10-20T15:00:00+08:00')).epochs.find((e) => e.id === 'palpha-p3');
  assert.equal(p3open.status, 'deposit-open');
  assert.equal(p3open.deposit.isOpen, true);
});

test('view carries dates and a config action period per epoch', () => {
  const [s1, s2] = resolveEpochs(APC, sec('2026-10-16T00:00:00+08:00')).epochs;
  assert.equal(s1.lockEnd, '2026-10-20T23:59:59+08:00');
  assert.equal(s1.deposit.isOpen, false);
  assert.equal(s1.actionPeriod.source, 'config');
  assert.equal(s1.actionPeriod.stale, true); // 10-12 window has passed
  assert.equal(s2.actionPeriod.isOpen, true); // 10-13 .. 2027-01-13
  assert.equal(s2.withdrawable, '2027-01-21T15:00:00+08:00');
  assert.equal(s2.terms.length, 2);
});

test('epoch without deposit: upcoming before lockStart, locked after', () => {
  const entry = { id: 'pALPHA', apyFallback: 0.14, epochs: [PALPHA.epochs[0]] };
  assert.equal(resolveEpochs(entry, sec('2026-07-01T00:00:00+08:00')).epochs[0].status, 'upcoming');
  assert.equal(resolveEpochs(entry, sec('2026-08-01T00:00:00+08:00')).epochs[0].deposit, null);
  assert.equal(resolveEpochs(entry, sec('2026-08-01T00:00:00+08:00')).epochs[0].status, 'locked');
});

test('terms are sorted by from; before the first tier the first tier is reported', () => {
  const e = { ...APC.epochs[1], terms: [...APC.epochs[1].terms].reverse() };
  const entry = { id: 'APC3M', apyFallback: 0.14, epochs: [e] };
  const v = resolveEpochs(entry, sec('2026-10-01T00:00:00+08:00')).epochs[0];
  assert.deepEqual(v.terms.map((t) => t.netApy), [0.13, 0.125]);
  assert.equal(v.status, 'upcoming');
  assert.equal(v.currentTerms.netApy, 0.13);
});

test('invalid epochs are skipped and reported', () => {
  const bad = { ...APC.epochs[1], id: 'bad-date', lockStart: 'nope' };
  const reversed = { ...APC.epochs[1], id: 'reversed', lockEnd: '2026-10-01T00:00:00+08:00' };
  const entry = { id: 'APC3M', apyFallback: 0.14, epochs: [bad, reversed, APC.epochs[1]] };
  const { epochs, errors } = resolveEpochs(entry, sec('2026-10-16T00:00:00+08:00'));
  assert.deepEqual(epochs.map((e) => e.id), ['apc-s2']);
  assert.deepEqual(errors.map((e) => e.scope), ['epochs:bad-date', 'epochs:reversed']);
});

test('no epochs configured → empty, no errors', () => {
  assert.deepEqual(resolveEpochs({ id: 'VRPC-Weekly', apyFallback: 0.1 }, 0), { epochs: [], errors: [] });
});

test('currentEpoch / epochApy / resolveActionPeriod follow the current epoch', () => {
  assert.equal(currentEpoch(APC, sec('2026-10-16T00:00:00+08:00')).id, 'apc-s1');
  assert.equal(epochApy(APC, sec('2026-10-16T00:00:00+08:00')), 0.14);
  assert.equal(epochApy(APC, sec('2026-10-21T00:00:00+08:00')), 0.125);
  assert.equal(epochApy(PALPHA, sec('2026-10-28T00:00:00+08:00')), 0.125);
  // no live epoch / no terms → apyFallback
  assert.equal(epochApy({ ...APC, apyFallback: 0.11 }, sec('2027-02-01T00:00:00+08:00')), 0.11);
  const noTerms = { id: 'APC3M', apyFallback: 0.09, epochs: [{ ...APC.epochs[1], terms: [] }] };
  assert.equal(resolveEpochs(noTerms, sec('2026-10-16T00:00:00+08:00')).epochs[0].currentTerms, null);
  assert.equal(epochApy(noTerms, sec('2026-10-16T00:00:00+08:00')), 0.09);
  // action period
  assert.equal(resolveActionPeriod(APC, sec('2026-10-21T00:00:00+08:00')).end, '2027-01-12T16:00:00.000Z');
  assert.equal(resolveActionPeriod(APC, sec('2027-02-01T00:00:00+08:00')).source, 'unavailable');
});

// attachR25Period: the R25 /vault/period window belongs to the live epoch whose
// `withdrawable` matches R25 nextMaturityDate within 1 day.
const NOW_OVERLAP = sec('2026-10-16T12:00:00+08:00');
const r25ap = (startIso, endIso, maturityIso) =>
  buildActionPeriod(sec(startIso), sec(endIso), maturityIso ? sec(maturityIso) : null, 'r25-api', NOW_OVERLAP);

test('attachR25Period: R25 matches the next epoch → top-level stays current config', () => {
  const views = resolveEpochs(APC, NOW_OVERLAP).epochs;
  const r25 = r25ap('2026-10-13T00:00:00+08:00', '2027-01-13T00:00:00+08:00', '2027-01-21T15:00:00+08:00');
  const out = attachR25Period(views, r25, sec('2027-01-21T15:00:00+08:00'), NOW_OVERLAP);
  assert.equal(out.actionPeriod.source, 'config');
  assert.equal(out.actionPeriod, out.epochs[0].actionPeriod);
  assert.equal(out.epochs[1].actionPeriod, r25);
  assert.equal(views[1].actionPeriod.source, 'config', 'input views are not mutated');
});

test('attachR25Period: R25 matches the current epoch (within 1 day) → R25 everywhere for it', () => {
  const views = resolveEpochs(APC, NOW_OVERLAP).epochs;
  const r25 = r25ap('2026-07-20T00:00:00+08:00', '2026-10-12T00:00:00+08:00', '2026-10-21T15:00:00+08:00');
  const out = attachR25Period(views, r25, sec('2026-10-21T15:00:00+08:00'), NOW_OVERLAP); // 15h off
  assert.equal(out.actionPeriod, r25);
  assert.equal(out.epochs[0].actionPeriod, r25);
  assert.equal(out.epochs[1].actionPeriod.source, 'config');
});

test('attachR25Period: no match / no maturity / no R25 → config everywhere', () => {
  const views = resolveEpochs(APC, NOW_OVERLAP).epochs;
  const r25 = r25ap('2026-10-13T00:00:00+08:00', '2027-01-13T00:00:00+08:00', null);
  for (const [ap, mat] of [[r25, sec('2026-10-22T00:00:01+08:00')], [r25, sec('2027-03-01T00:00:00+08:00')], [r25, null], [null, null]]) {
    const out = attachR25Period(views, ap, mat, NOW_OVERLAP);
    assert.deepEqual(out.epochs.map((e) => e.actionPeriod.source), ['config', 'config']);
    assert.equal(out.actionPeriod, out.epochs[0].actionPeriod);
  }
});

test('attachR25Period: no live epoch → R25 if available, else unavailable', () => {
  const r25 = r25ap('2026-10-13T00:00:00+08:00', '2027-01-13T00:00:00+08:00', '2027-01-21T15:00:00+08:00');
  const withR25 = attachR25Period([], r25, sec('2027-01-21T15:00:00+08:00'), NOW_OVERLAP);
  assert.deepEqual(withR25.epochs, []);
  assert.equal(withR25.actionPeriod, r25);
  assert.equal(attachR25Period([], null, null, NOW_OVERLAP).actionPeriod.source, 'unavailable');
});

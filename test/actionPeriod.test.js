import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActionPeriod } from '../src/logic/actionPeriod.ts';

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

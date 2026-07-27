import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActionPeriod } from '../src/logic/actionPeriod.ts';

const apc = {
  id: 'APC3M', navSource: 'onchain',
  actionPeriodConfig: {
    lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
    actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00',
    withdrawable: '2026-10-20',
  },
};
const pa = {
  id: 'pALPHA', navSource: 'api',
  actionPeriodConfig: apc.actionPeriodConfig,
};

test('APC3M uses config', () => {
  const now = Math.floor(Date.parse('2026-08-01T00:00:00+08:00') / 1000);
  const ap = resolveActionPeriod(apc, null, now);
  assert.equal(ap.source, 'config');
  assert.equal(ap.isOpen, true); // 08-01 within 07-20..10-16
});

test('pALPHA prefers API phase containing now', () => {
  const now = 1783600000; // within phase[0] 1783508400..1784199600
  const apiInfo = {
    apy: 0.14, nav: 1.03, withdrawableTs: 1784545200, minWithdrawalShares: 0.1,
    phases: [
      { startTs: 1783508400, endTs: 1784199600, apy: 0.16 },
      { startTs: 1776643200, endTs: 1784545200, apy: 0.14 },
    ],
  };
  const ap = resolveActionPeriod(pa, apiInfo, now);
  assert.equal(ap.source, 'api');
  assert.equal(ap.startTs, 1783508400);
  assert.equal(ap.isOpen, true);
  assert.equal(ap.withdrawableDate, '2026-07-20'); // secToIso(1784545200) date part (UTC)
});

test('pALPHA falls back to config when API empty', () => {
  const now = Math.floor(Date.parse('2026-09-20T00:00:00+08:00') / 1000);
  const apiInfo = { apy: null, nav: null, withdrawableTs: null, minWithdrawalShares: null, phases: [] };
  const ap = resolveActionPeriod(pa, apiInfo, now);
  assert.equal(ap.source, 'config');
});

test('unavailable when config unparseable and no api', () => {
  const broken = { id: 'APC3M', navSource: 'onchain', actionPeriodConfig: { actionStart: 'nope', actionEnd: 'nope', withdrawable: 'nope', lockStart: 'x', lockEnd: 'x' } };
  const ap = resolveActionPeriod(broken, null, 1000);
  assert.equal(ap.source, 'unavailable');
  assert.equal(ap.startTs, null);
});

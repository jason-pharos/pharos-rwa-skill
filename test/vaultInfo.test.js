import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVaultInfo } from '../src/sources/vaultInfo.ts';

const sample = {
  overview: {
    totalApy: 0.14,
    withdrawableTimestamp: 1784545200,
    minWithdrawalShares: 0.1,
    phases: [
      { startTimestamp: 1783508400, endTimestamp: 1784199600, apy: 0.16 },
      { startTimestamp: 1776643200, endTimestamp: 1784545200, apy: 0.14 },
    ],
  },
  vaultInfo: { receiptTokenPrice: 1.034760941 },
};

test('extracts nav from receiptTokenPrice', () => {
  assert.equal(extractVaultInfo(sample).nav, 1.034760941);
});
test('extracts apy + withdrawable + phases', () => {
  const vi = extractVaultInfo(sample);
  assert.equal(vi.apy, 0.14);
  assert.equal(vi.withdrawableTs, 1784545200);
  assert.equal(vi.phases.length, 2);
  assert.equal(vi.phases[0].startTs, 1783508400);
});
test('missing fields → nulls, empty phases', () => {
  const vi = extractVaultInfo({});
  assert.equal(vi.nav, null);
  assert.equal(vi.apy, null);
  assert.deepEqual(vi.phases, []);
});

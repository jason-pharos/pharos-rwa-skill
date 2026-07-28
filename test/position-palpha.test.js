import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePAlphaPosition } from '../src/logic/position-palpha.ts';

const entry = {
  id: 'pALPHA', entryNavBaseline: 1.0, apyFallback: 0.14,
  emberVaultId: '1502a2c9-3ea1-4f0d-b513-fb79e3dbbe1f',
  actionPeriodConfig: {
    lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T19:00:00+08:00',
    actionStart: '2026-09-17T11:00:00+08:00', actionEnd: '2026-10-01T00:00:00+08:00', withdrawable: '2026-10-20',
  },
};
const ap = { source: 'config', start: null, end: null, startTs: null, endTs: null, withdrawableDate: '2026-10-20', isOpen: false, opensInDays: null, closesInDays: null, stale: false };
const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);

// Real shape from GET /omni_port/ember/api/v2/vaults/positions/account/{addr}
const emberPosition = {
  vaultId: '1502a2c9-3ea1-4f0d-b513-fb79e3dbbe1f',
  positionValueUsdE9: '3479765833788',
  positionValueInCoinAmount: '3480287146',
  shares: '3363015940',
  unrealizedYieldUsdE9: '116980946798',
  unrealizedYieldInCoinAmount: '116998472',
  realizedYieldUsdE9: '0',
  realizedYieldInCoinAmount: '0',
  totalYieldUsdE9: '116980946798',
  totalYieldInCoinAmount: '116998472',
  status: 'SYNC',
};
const base = { entry, sharesHuman: '3363.01594', nav: 1.035, apy: 0.14, actionPeriod: ap, now, emberPosition };

test('value + yield come from the Ember API, principal is derived', () => {
  const p = computePAlphaPosition(base);
  assert.ok(Math.abs(p.currentValue - 3479.765833788) < 1e-9);
  assert.ok(Math.abs(p.realizedYield - 116.980946798) < 1e-9);
  assert.ok(Math.abs(p.principal - (3479.765833788 - 116.980946798)) < 1e-9);
  assert.equal(p.assumptions.valueResolvedFrom, 'ember-api');
  assert.equal(p.assumptions.emberStatus, 'SYNC');
});

test('realized/unrealized split is reported and sums to realizedYield', () => {
  const p = computePAlphaPosition(base);
  assert.equal(p.yieldBreakdown.realized, 0);
  assert.ok(Math.abs(p.yieldBreakdown.unrealized - 116.980946798) < 1e-9);
  assert.ok(Math.abs(p.yieldBreakdown.realized + p.yieldBreakdown.unrealized - p.realizedYield) < 1e-9);
});

test('realized yield after a partial settlement still totals correctly', () => {
  const p = computePAlphaPosition({
    ...base,
    emberPosition: { ...emberPosition, realizedYieldUsdE9: '3756452', unrealizedYieldUsdE9: '282421802', totalYieldUsdE9: '286178254' },
  });
  assert.ok(Math.abs(p.yieldBreakdown.realized - 0.003756452) < 1e-12);
  assert.ok(Math.abs(p.realizedYield - 0.286178254) < 1e-12);
});

test('expectedTotalYield projects earned-to-date forward to lock end', () => {
  const p = computePAlphaPosition(base);
  const yearsLeft = (Date.parse('2026-10-20T19:00:00+08:00') - Date.parse('2026-07-27T00:00:00+08:00')) / 1000 / 31557600;
  assert.ok(Math.abs(p.expectedTotalYield - (116.980946798 + 3479.765833788 * 0.14 * yearsLeft)) < 1e-6);
  // The regression this guards: expected must never come out below what the
  // position has already earned.
  assert.ok(p.expectedTotalYield > p.realizedYield);
  assert.equal(p.assumptions.expectedYieldBasis, 'earned-to-date + apy x time-to-lock-end');
});

test('after lock end there is no time left to project — expected == earned', () => {
  const p = computePAlphaPosition({ ...base, now: Math.floor(Date.parse('2026-11-01T00:00:00+08:00') / 1000) });
  assert.ok(Math.abs(p.expectedTotalYield - p.realizedYield) < 1e-9);
});

test('shares / nav / lock timing stay on-chain + config sourced', () => {
  const p = computePAlphaPosition(base);
  assert.equal(p.shares, '3363.01594');
  assert.equal(p.nav, 1.035);
  assert.equal(p.assumptions.navResolvedFrom, 'onchain');
  assert.equal(p.depositedDurationDays, 7);
  assert.equal(p.lockEnd, '2026-10-20T19:00:00+08:00');
});

test('unparseable API money fields degrade to null instead of NaN', () => {
  const p = computePAlphaPosition({
    ...base,
    emberPosition: { ...emberPosition, positionValueUsdE9: '', totalYieldUsdE9: '' },
  });
  assert.equal(p.currentValue, null);
  assert.equal(p.realizedYield, null);
  assert.equal(p.principal, null);
  assert.equal(p.expectedTotalYield, null);
  assert.equal(p.yieldBreakdown, undefined);
});

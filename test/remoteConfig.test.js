import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRegistry } from '../src/config/remoteConfig.ts';
import { DEFAULT_REGISTRY } from '../src/config/registry.ts';

test('override merges by id, keeps unknown defaults intact', () => {
  const merged = mergeRegistry(DEFAULT_REGISTRY, {
    version: 1,
    vaults: [{ id: 'APC3M', apyFallback: 0.2 }],
  });
  const apc = merged.find((v) => v.id === 'APC3M');
  const pa = merged.find((v) => v.id === 'pALPHA');
  assert.equal(apc.apyFallback, 0.2);
  assert.equal(apc.onchainNav.vault, '0xD0428799FbC35557834d33121BA4472692c8908a'); // untouched
  assert.equal(pa.apyFallback, 0.14); // untouched
});

test('malformed override falls back to base', () => {
  const merged = mergeRegistry(DEFAULT_REGISTRY, null);
  assert.equal(merged.length, DEFAULT_REGISTRY.length);
});

test('identity/address fields protected from remote override', () => {
  const merged = mergeRegistry(DEFAULT_REGISTRY, {
    version: 1,
    vaults: [
      {
        id: 'APC3M',
        shareToken: '0xATTACKER0000000000000000000000000000001111',
        onchainNav: { vault: '0xATTACKER0000000000000000000000000000002222', shareDecimals: 0, assetDecimals: 0 },
        chainId: 999,
        displayName: 'HACKED',
        apyFallback: 0.5,
      },
    ],
  });
  const apc = merged.find((v) => v.id === 'APC3M');
  // Identity/address fields are unchanged despite override attempts
  assert.equal(apc.shareToken, '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0');
  assert.equal(apc.onchainNav.vault, '0xD0428799FbC35557834d33121BA4472692c8908a');
  assert.equal(apc.onchainNav.assetDecimals, 6);
  assert.equal(apc.chainId, 1672);
  assert.equal(apc.displayName, 'AxilPrimeCredit-3M');
  // Only policy/value fields can be overridden
  assert.equal(apc.apyFallback, 0.5);
});

test('registry balanceSources: pALPHA spans Pharos+Ethereum, APC3M single Pharos', () => {
  const apc = DEFAULT_REGISTRY.find((v) => v.id === 'APC3M');
  const pa = DEFAULT_REGISTRY.find((v) => v.id === 'pALPHA');
  // APC3M: single Pharos source
  assert.equal(apc.balanceSources.length, 1);
  assert.equal(apc.balanceSources[0].chainId, 1672);
  assert.equal(apc.balanceSources[0].token, '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0');
  // pALPHA: Pharos + Ethereum, distinct receipt tokens per chain
  assert.equal(pa.balanceSources.length, 2);
  const byChain = Object.fromEntries(pa.balanceSources.map((s) => [s.chainId, s]));
  assert.equal(byChain[1672].token, '0xE47E9bA4EA2320A6ed87246d02Fd5C38485Ed7d1');
  assert.equal(byChain[1].token, '0xC3AaCb558aFB635307B66FDb405188138576fc4c');
  assert.equal(byChain[1].rpcUrlEnv, 'ETHEREUM_RPC_URL');
});

test('registry: both VRPC vaults are redeemability-based with correct lockDays', () => {
  const wk = DEFAULT_REGISTRY.find((v) => v.id === 'VRPC-Weekly');
  const sy = DEFAULT_REGISTRY.find((v) => v.id === 'VRPC-SemiYearly');
  assert.ok(wk && sy);
  assert.equal(wk.redeemability.lockDays, 7);
  assert.equal(sy.redeemability.lockDays, 184);
  assert.equal(wk.redeemability.vault, '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268');
  assert.equal(wk.actionPeriodConfig, undefined); // no fixed dates
  assert.equal(wk.onchainNav.assetDecimals, 6);
});

test('APC3M registry matches APC Season 2 windows; depositPeriodConfig overridable', () => {
  const apc = DEFAULT_REGISTRY.find((v) => v.id === 'APC3M');
  assert.equal(apc.actionPeriodConfig.actionStart, '2026-10-13T00:00:00+08:00');
  assert.equal(apc.actionPeriodConfig.actionEnd, '2027-01-13T00:00:00+08:00');
  assert.equal(apc.actionPeriodConfig.lockStart, '2026-10-20T15:00:00+08:00');
  assert.equal(apc.actionPeriodConfig.lockEnd, '2027-01-21T15:00:00+08:00');
  assert.equal(apc.depositPeriodConfig.preEnd, '2026-10-20T15:00:00+08:00');
  const merged = mergeRegistry(DEFAULT_REGISTRY, {
    version: 1,
    vaults: [{ id: 'APC3M', depositPeriodConfig: { extendEnd: '2026-10-28T09:00:00+08:00', extend: { netApy: 0.12 } } }],
  });
  const m = merged.find((v) => v.id === 'APC3M');
  assert.equal(m.depositPeriodConfig.extendEnd, '2026-10-28T09:00:00+08:00');
  assert.equal(m.depositPeriodConfig.preStart, '2026-10-13T00:00:00+08:00'); // untouched
  assert.equal(m.depositPeriodConfig.extend.netApy, 0.12);
  assert.equal(m.depositPeriodConfig.extend.performanceFeeRate, 0.1); // nested terms deep-merged
});

test('pALPHA registry matches pAlpha phase 3 windows', () => {
  const pa = DEFAULT_REGISTRY.find((v) => v.id === 'pALPHA');
  assert.deepEqual(pa.actionPeriodConfig, {
    lockStart: '2026-10-20T15:00:00+08:00',
    lockEnd: '2027-01-21T15:00:00+08:00',
    actionStart: '2026-12-18T11:00:00+08:00',
    actionEnd: '2027-01-01T11:00:00+08:00',
    withdrawable: '2027-01-21',
  });
});

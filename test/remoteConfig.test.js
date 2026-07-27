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
  assert.equal(apc.coreVault, '0xD0428799FbC35557834d33121BA4472692c8908a'); // untouched
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
        coreVault: '0xATTACKER0000000000000000000000000000002222',
        usdc: '0xATTACKER0000000000000000000000000000003333',
        chainId: 999,
        navSource: 'api',
        displayName: 'HACKED',
        apyFallback: 0.5,
      },
    ],
  });
  const apc = merged.find((v) => v.id === 'APC3M');
  // Identity/address fields are unchanged despite override attempts
  assert.equal(apc.shareToken, '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0');
  assert.equal(apc.coreVault, '0xD0428799FbC35557834d33121BA4472692c8908a');
  assert.equal(apc.usdc, '0xC879C018dB60520F4355C26eD1a6D572cdAC1815');
  assert.equal(apc.chainId, 1672);
  assert.equal(apc.navSource, 'onchain');
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

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
  assert.equal(wk.epochs, undefined); // no fixed dates
  assert.equal(wk.onchainNav.assetDecimals, 6);
});

test('registry epochs: APC S1/S2 and pALPHA P2/P3 match omni-port-fe', () => {
  const view = (id) => DEFAULT_REGISTRY.find((v) => v.id === id).epochs.map((e) => ({
    id: e.id, deposit: e.deposit ?? null, lock: [e.lockStart, e.lockEnd], action: [e.actionStart, e.actionEnd],
    withdrawable: e.withdrawable, terms: e.terms.map((t) => [t.from, t.grossApy, t.performanceFeeRate, t.netApy]),
  }));
  assert.deepEqual(view('APC3M'), [
    {
      id: 'apc-s1', deposit: { start: '2026-07-15T16:00:00+08:00', end: '2026-07-19T23:59:00+08:00' },
      lock: ['2026-07-20T00:00:00+08:00', '2026-10-20T23:59:59+08:00'],
      action: ['2026-07-20T00:00:00+08:00', '2026-10-12T00:00:00+08:00'],
      withdrawable: '2026-10-20T23:59:59+08:00',
      terms: [['2026-07-15T16:00:00+08:00', 0.14, 0, 0.14]],
    },
    {
      id: 'apc-s2', deposit: { start: '2026-10-13T00:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
      lock: ['2026-10-20T15:00:00+08:00', '2027-01-21T15:00:00+08:00'],
      action: ['2026-10-13T00:00:00+08:00', '2027-01-13T00:00:00+08:00'],
      withdrawable: '2027-01-21T15:00:00+08:00',
      terms: [['2026-10-13T00:00:00+08:00', 0.13, 0, 0.13], ['2026-10-20T15:00:00+08:00', 0.138, 0.1, 0.125]],
    },
  ]);
  assert.deepEqual(view('pALPHA'), [
    {
      id: 'palpha-p2', deposit: null,
      lock: ['2026-07-20T19:00:00+08:00', '2026-10-20T19:00:00+08:00'],
      action: ['2026-09-17T11:00:00+08:00', '2026-10-01T00:00:00+08:00'],
      withdrawable: '2026-10-20T19:00:00+08:00',
      terms: [['2026-07-20T19:00:00+08:00', 0.14, 0, 0.14]],
    },
    {
      id: 'palpha-p3', deposit: { start: '2026-10-20T15:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
      lock: ['2026-10-20T15:00:00+08:00', '2027-01-21T15:00:00+08:00'],
      action: ['2026-12-18T11:00:00+08:00', '2027-01-01T11:00:00+08:00'],
      withdrawable: '2027-01-21T15:00:00+08:00',
      terms: [['2026-10-20T15:00:00+08:00', 0.138, 0, 0.138], ['2026-10-27T09:00:00+08:00', 0.138, 0.1, 0.125]],
    },
  ]);
});

test('registry epoch times all carry an explicit +08:00 timestamp', () => {
  for (const v of DEFAULT_REGISTRY) {
    for (const e of v.epochs ?? []) {
      const times = [e.lockStart, e.lockEnd, e.actionStart, e.actionEnd, e.withdrawable,
        ...(e.deposit ? [e.deposit.start, e.deposit.end] : []), ...e.terms.map((t) => t.from)];
      for (const t of times) assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/, `${e.id}: ${t}`);
    }
  }
});

test('remote config cannot override epochs', () => {
  const merged = mergeRegistry(DEFAULT_REGISTRY, { version: 1, vaults: [{ id: 'APC3M', epochs: [], apyFallback: 0.2 }] });
  const apc = merged.find((v) => v.id === 'APC3M');
  assert.equal(apc.epochs.length, 2);
  assert.equal(apc.apyFallback, 0.2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPositions } from '../src/index.ts';

/**
 * These tests cover the R25-integration regression: the R25 pre-fetch used to
 * run as a serial gate in front of EVERY vault, so pALPHA — which needs no R25
 * data at all (no r25VaultId; its value comes from the Ember accounts API) —
 * was stuck behind up to 6 sequential 12s R25 timeouts when app.r25.xyz was
 * unreachable. Measured worst case: 63.5s, with every failure swallowed
 * silently so errors[] stayed empty.
 *
 * They exercise buildPositions through an injected-dependency seam rather than
 * the network, so the invariants are asserted deterministically (call ordering
 * and a bounded deadline) instead of by wall-clock sleeps.
 */

const PALPHA = {
  id: 'pALPHA',
  displayName: 'Pharos RealFi Ecosystem Vault',
  chainId: 1672,
  emberVaultId: 'ember-uuid',
  shareToken: '0xE47E9bA4EA2320A6ed87246d02Fd5C38485Ed7d1',
  balanceSources: [
    { chainId: 1672, token: '0xE47E9bA4EA2320A6ed87246d02Fd5C38485Ed7d1', decimals: 6 },
    { chainId: 1, token: '0xC3AaCb558aFB635307B66FDb405188138576fc4c', decimals: 6 },
  ],
  onchainNav: { vault: '0xE47E9bA4EA2320A6ed87246d02Fd5C38485Ed7d1', shareDecimals: 6, assetDecimals: 6 },
  entryNavBaseline: 1.0,
  apyFallback: 0.14,
  actionPeriodConfig: {
    lockStart: '2026-07-20T19:00:00+08:00', lockEnd: '2026-10-20T19:00:00+08:00',
    actionStart: '2026-09-17T11:00:00+08:00', actionEnd: '2026-10-01T00:00:00+08:00',
    withdrawable: '2026-10-20',
  },
};

const APC3M = {
  id: 'APC3M',
  displayName: 'AxilPrimeCredit-3M',
  chainId: 1672,
  r25VaultId: 'APC3M',
  shareToken: '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0',
  balanceSources: [{ chainId: 1672, token: '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0', decimals: 18 }],
  onchainNav: { vault: '0xD0428799FbC35557834d33121BA4472692c8908a', shareDecimals: 18, assetDecimals: 6 },
  entryNavBaseline: 1.0,
  apyFallback: 0.14,
  actionPeriodConfig: {
    lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
    actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00',
    withdrawable: '2026-10-20',
  },
};

const EMBER_POSITION = {
  vaultId: 'ember-uuid',
  positionValueUsdE9: '3483139502379',
  shares: '3362015940',
  unrealizedYieldUsdE9: '118045257821',
  realizedYieldUsdE9: '3555603458',
  totalYieldUsdE9: '121600861281',
  status: 'SYNC',
};

const NOW = Math.floor(Date.parse('2026-07-31T10:00:00+08:00') / 1000);
const ADDR = '0x68c8C1b8CA4C82b922675b25B8E1867b5C3d0fb6';

/** A promise plus its resolve handle, for pinning a dependency mid-flight. */
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function sharesOf(human, raw, decimals) {
  return { totalHuman: human, totalRaw: raw, decimals, sources: [], errors: [] };
}

/** Dependency set that succeeds everywhere; individual tests override one part. */
function okDeps(overrides = {}) {
  return {
    registry: [PALPHA, APC3M],
    getVaultShares: async () => sharesOf('3362.01594', 3362015940n, 6),
    getVaultNavOnchain: async () => 1.036247,
    getRedeemability: async () => { throw new Error('not used in these tests'); },
    fetchEmberPositionValue: async () => EMBER_POSITION,
    fetchR25Holdings: async () => [],
    fetchR25VaultPeriod: async () => null,
    fetchR25Positions: async () => null,
    fetchR25Activity: async () => null,
    ...overrides,
  };
}

test('pALPHA resolves without waiting for the R25 pre-fetch to settle', async () => {
  // R25 holdings never settles during this test — standing in for app.r25.xyz
  // being unreachable from the agent host.
  const gate = deferred();
  let emberCalledWhileR25Pending = false;

  const deps = okDeps({
    fetchR25Holdings: () => gate.promise,
    fetchEmberPositionValue: async () => {
      // The invariant: pALPHA's own data fetch must already be in flight while
      // the R25 gate is still open. Under the serial pre-fetch it could not be.
      emberCalledWhileR25Pending = true;
      return EMBER_POSITION;
    },
  });

  const errors = [];
  const run = buildPositions(ADDR, { noRemote: true, now: NOW, r25DeadlineMs: 50 }, errors, deps);
  const positions = await run;
  gate.resolve([]); // let the abandoned R25 call finish harmlessly

  assert.equal(emberCalledWhileR25Pending, true,
    'pALPHA must fetch its own data concurrently with the R25 pre-fetch, not after it');
  const palpha = positions.find((p) => p.vault === 'pALPHA');
  assert.ok(palpha, 'pALPHA must be reported even though R25 never answered');
  assert.equal(palpha.assumptions.valueResolvedFrom, 'ember-api');
});

test('an unreachable R25 API is bounded by a deadline and recorded in errors[]', async () => {
  const deps = okDeps({
    fetchR25Holdings: () => new Promise(() => {}), // never settles
  });

  const errors = [];
  const positions = await buildPositions(ADDR, { noRemote: true, now: NOW, r25DeadlineMs: 50 }, errors, deps);

  assert.ok(positions.find((p) => p.vault === 'pALPHA'), 'pALPHA must survive an R25 outage');
  assert.ok(errors.some((e) => e.scope.startsWith('r25')),
    `an R25 outage must be visible in errors[], got ${JSON.stringify(errors)}`);
});

test('pALPHA is still reported when every chain balance read fails', async () => {
  // Both pALPHA chains down (its Ethereum fallback list has real rot: llamarpc
  // returns 521, ankr does not respond). The Ember API still knows the
  // position, so dropping it entirely reports "no holdings" to a user who holds
  // ~3.5k USDC.
  const deps = okDeps({
    getVaultShares: async () => ({
      totalHuman: '0.0', totalRaw: 0n, decimals: 6, sources: [],
      errors: [
        { chainId: 1672, error: 'connect ECONNREFUSED' },
        { chainId: 1, error: 'server response 521' },
      ],
    }),
    getVaultNavOnchain: async () => { throw new Error('rpc down'); },
  });

  const errors = [];
  const positions = await buildPositions(ADDR, { noRemote: true, now: NOW }, errors, deps);

  const palpha = positions.find((p) => p.vault === 'pALPHA');
  assert.ok(palpha, 'pALPHA must not be dropped when Ember has the position');
  assert.ok(Math.abs(palpha.currentValue - 3483.139502379) < 1e-9);
  assert.equal(palpha.shares, null, 'shares are unknown when every chain read failed');
  assert.equal(palpha.assumptions.sharesResolvedFrom, 'unavailable');
});

test('a vault with no shares, no R25 holding and no Ember data is still skipped', async () => {
  // The flip side of the fallback: it must not resurrect genuinely empty vaults.
  const deps = okDeps({
    getVaultShares: async () => sharesOf('0.0', 0n, 6),
    fetchEmberPositionValue: async () => null,
  });

  const errors = [];
  const positions = await buildPositions(ADDR, { noRemote: true, now: NOW }, errors, deps);
  assert.deepEqual(positions, []);
});

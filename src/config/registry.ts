import type { VaultRegistryEntry } from '../types.ts';

export const DEFAULT_REGISTRY: VaultRegistryEntry[] = [
  {
    id: 'APC3M',
    displayName: 'AxilPrimeCredit-3M',
    chainId: 1672,
    shareToken: '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0',
    balanceSources: [
      {
        chainId: 1672,
        rpcUrlEnv: 'PHAROS_RPC_URL',
        rpcUrl: 'https://rpc.pharos.xyz',
        token: '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0',
        decimals: 18,
      },
    ],
    // NAV on-chain: CoreVault.convertToAssets(1 share); share 18 decimals, asset USDC 6.
    onchainNav: {
      vault: '0xD0428799FbC35557834d33121BA4472692c8908a',
      shareDecimals: 18,
      assetDecimals: 6,
    },
    entryNavBaseline: 1.0,
    apyFallback: 0.14,
    r25VaultId: 'APC3M',
    // Operating periods (UTC+8) from omni-port-fe: S1 = apps/port/.env prod
    // values, S2 = APC_SEASON2_DEFAULTS + SEASON2_APY. Every epoch not yet past
    // `withdrawable` is reported (logic/epochs.ts). New season → append an epoch.
    // S2 "Deposit Period (Pre)" / "(Extend)" are two APY/fee tiers of ONE
    // deposit window, hence two `terms` entries rather than two windows.
    epochs: [
      {
        id: 'apc-s1',
        label: 'Season 1',
        deposit: { start: '2026-07-15T16:00:00+08:00', end: '2026-07-19T23:59:00+08:00' },
        lockStart: '2026-07-20T00:00:00+08:00',
        lockEnd: '2026-10-20T23:59:59+08:00',
        actionStart: '2026-07-20T00:00:00+08:00',
        actionEnd: '2026-10-12T00:00:00+08:00',
        withdrawable: '2026-10-20T23:59:59+08:00',
        terms: [
          { from: '2026-07-15T16:00:00+08:00', label: 'Season 1', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 },
        ],
      },
      {
        id: 'apc-s2',
        label: 'Season 2',
        deposit: { start: '2026-10-13T00:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
        lockStart: '2026-10-20T15:00:00+08:00',
        lockEnd: '2027-01-21T15:00:00+08:00',
        actionStart: '2026-10-13T00:00:00+08:00',
        actionEnd: '2027-01-13T00:00:00+08:00',
        withdrawable: '2027-01-21T15:00:00+08:00',
        terms: [
          { from: '2026-10-13T00:00:00+08:00', label: 'Deposit Period (Pre)', grossApy: 0.13, performanceFeeRate: 0, netApy: 0.13 },
          { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period (Extend) & Lock', grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
        ],
      },
    ],
  },
  {
    id: 'pALPHA',
    displayName: 'Pharos RealFi Ecosystem Vault',
    chainId: 1672,
    // Ember accounts API vault UUID — position value + realized/unrealized
    // yield come from there for this vault (see logic/position-palpha.ts).
    emberVaultId: '1502a2c9-3ea1-4f0d-b513-fb79e3dbbe1f',
    shareToken: '0xE47E9bA4EA2320A6ed87246d02Fd5C38485Ed7d1',
    balanceSources: [
      {
        chainId: 1672,
        rpcUrlEnv: 'PHAROS_RPC_URL',
        rpcUrl: 'https://rpc.pharos.xyz',
        token: '0xE47E9bA4EA2320A6ed87246d02Fd5C38485Ed7d1',
        decimals: 6,
      },
      {
        chainId: 1,
        rpcUrlEnv: 'ETHEREUM_RPC_URL',
        rpcUrl: 'https://ethereum-rpc.publicnode.com',
        // Verified reachable 2026-07-30. Dropped from this list: eth.llamarpc.com
        // (HTTP 521) and rpc.ankr.com/eth (no response) — both dead, and a dead
        // fallback costs a full connect timeout before the next one is tried.
        rpcUrlFallbacks: [
          'https://eth.drpc.org',
        ],
        token: '0xC3AaCb558aFB635307B66FDb405188138576fc4c',
        decimals: 6,
      },
    ],
    // NAV on-chain: the Pharos receipt token is ERC4626-like and exposes
    // convertToAssets; share + asset (USDC) both 6 decimals.
    onchainNav: {
      vault: '0xE47E9bA4EA2320A6ed87246d02Fd5C38485Ed7d1',
      shareDecimals: 6,
      assetDecimals: 6,
    },
    entryNavBaseline: 1.0,
    apyFallback: 0.14,
    // Operating periods (UTC+8), synchronized from the omni-port-fe prod
    // configuration. P2 uses the confirmed Season 2 schedule; P3 follows
    // commit b26cd0d's corrected window. The action period is the
    // withdraw-REQUEST window inside the lock — not the lock end.
    epochs: [
      {
        id: 'palpha-p2',
        label: 'Phase 2',
        // Confirmed pALPHA Season 2 prod schedule.
        deposit: { start: '2026-04-13T19:00:00+08:00', end: '2026-04-20T07:59:00+08:00' },
        lockStart: '2026-04-20T08:00:00+08:00',
        lockEnd: '2026-07-20T19:00:00+08:00',
        actionStart: '2026-09-15T00:00:00+08:00',
        actionEnd: '2026-10-01T00:00:00+08:00',
        withdrawable: '2026-10-20T19:00:00+08:00',
        terms: [
          { from: '2026-04-13T19:00:00+08:00', label: 'Phase 2', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 },
        ],
      },
      {
        id: 'palpha-p3',
        label: 'Phase 3',
        // Matches omni-port-fe commit b26cd0d's corrected pAlpha window.
        deposit: { start: '2026-10-20T19:00:00+08:00', end: '2026-10-27T19:00:00+08:00' },
        lockStart: '2026-10-20T19:00:00+08:00',
        lockEnd: '2027-01-21T19:00:00+08:00',
        actionStart: '2026-12-18T11:00:00+08:00',
        actionEnd: '2027-01-01T11:00:00+08:00',
        withdrawable: '2027-01-21T19:00:00+08:00',
        terms: [
          { from: '2026-10-20T19:00:00+08:00', label: 'Deposit Period', grossApy: 0.138, performanceFeeRate: 0, netApy: 0.138 },
          { from: '2026-10-27T19:00:00+08:00', label: 'Lock Period', grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
        ],
      },
    ],
  },
  {
    id: 'VRPC-SemiYearly',
    displayName: 'VRPC-SemiYearly',
    chainId: 1672,
    shareToken: '0xee26bb0989691735c997dfdc49a4a607f75e190b',
    balanceSources: [
      {
        chainId: 1672,
        rpcUrlEnv: 'PHAROS_RPC_URL',
        rpcUrl: 'https://rpc.pharos.xyz',
        token: '0xee26bb0989691735c997dfdc49a4a607f75e190b',
        decimals: 6,
      },
    ],
    // NAV on-chain: the vault is ERC-4626/7540 and exposes convertToAssets;
    // share + asset (USDC) both 6 decimals.
    onchainNav: {
      vault: '0xee26bb0989691735c997dfdc49a4a607f75e190b',
      shareDecimals: 6,
      assetDecimals: 6,
    },
    // ERC-7540 async-redeem vault. Lock is 184 days from each user's OWN
    // deposit and a withdraw request must be made >=7 days before maturity —
    // there is NO fixed global window and the contract exposes no per-user
    // deposit/maturity timestamp. So the action period is derived live from
    // the contract's redeemability (maxRedeem / pending / claimable) instead
    // of config dates. requestId 0 (single-request vault).
    redeemability: {
      vault: '0xee26bb0989691735c997dfdc49a4a607f75e190b',
      shareDecimals: 6,
      requestId: 0,
      lockDays: 184,
      async: true,
    },
    entryNavBaseline: 1.0,
    apyFallback: 0.15,
    r25VaultId: 'VRPCS',
    // no epochs — see redeemability above.
  },
  {
    id: 'VRPC-Weekly',
    displayName: 'VRPC-Weekly',
    chainId: 1672,
    shareToken: '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268',
    balanceSources: [
      {
        chainId: 1672,
        rpcUrlEnv: 'PHAROS_RPC_URL',
        rpcUrl: 'https://rpc.pharos.xyz',
        token: '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268',
        decimals: 6,
      },
    ],
    // NAV on-chain: ERC-4626 vault, convertToAssets; share + asset (USDC) 6 dec.
    onchainNav: {
      vault: '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268',
      shareDecimals: 6,
      assetDecimals: 6,
    },
    // Like VRPC-SemiYearly but a 7-day lock and PLAIN ERC-4626 (SYNC redeem):
    // maxRedeem works; pendingRedeemRequest/claimableRedeemRequest do NOT exist
    // (they revert) — getRedeemability tolerates that, so pending/claimable stay
    // 0. No fixed dates / no on-chain deposit timestamp → redeemability-based.
    redeemability: {
      vault: '0x1c2bc8b553d9a7e61f7531a3a4bf2162f4569268',
      shareDecimals: 6,
      requestId: 0,
      lockDays: 7,
      async: false,
    },
    entryNavBaseline: 1.0,
    apyFallback: 0.08,
    r25VaultId: 'VRPCW',
    // no epochs — see redeemability above.
  },
];

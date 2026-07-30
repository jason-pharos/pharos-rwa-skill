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
    actionPeriodConfig: {
      lockStart: '2026-07-20T00:00:00+08:00',
      lockEnd: '2026-10-20T23:59:59+08:00',
      actionStart: '2026-07-20T00:00:00+08:00',
      actionEnd: '2026-10-16T00:00:00+08:00',
      withdrawable: '2026-10-20',
    },
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
    // Lock runs one epoch (3 months) from the previous epoch's settlement:
    // the vault-info API's last epoch ended 2026-07-20T11:00Z and the app's
    // withdrawable timestamp for this epoch is 1792494000 = 2026-10-20T11:00Z
    // (= 19:00+08). The action period (09-17 → 10-01) is the withdraw-REQUEST
    // window inside the lock — it is NOT the lock end or the withdrawable date.
    actionPeriodConfig: {
      lockStart: '2026-07-20T19:00:00+08:00',
      lockEnd: '2026-10-20T19:00:00+08:00',
      actionStart: '2026-09-17T11:00:00+08:00',
      actionEnd: '2026-10-01T00:00:00+08:00',
      withdrawable: '2026-10-20',
    },
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
    },
    entryNavBaseline: 1.0,
    apyFallback: 0.15,
    // no actionPeriodConfig — see redeemability above.
  },
];

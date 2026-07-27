import type { VaultRegistryEntry } from '../types.ts';

export const DEFAULT_REGISTRY: VaultRegistryEntry[] = [
  {
    id: 'APC3M',
    displayName: 'AxilPrimeCredit-3M',
    chainId: 1672,
    shareToken: '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0',
    coreVault: '0xD0428799FbC35557834d33121BA4472692c8908a',
    usdc: '0xC879C018dB60520F4355C26eD1a6D572cdAC1815',
    navSource: 'onchain',
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
    shareToken: '0xC3AaCb558aFB635307B66FDb405188138576fc4c',
    vaultId: '1502a2c9-3ea1-4f0d-b513-fb79e3dbbe1f',
    navSource: 'api',
    entryNavBaseline: 1.0,
    apyFallback: 0.14,
    actionPeriodConfig: {
      lockStart: '2026-07-20T00:00:00+08:00',
      lockEnd: '2026-10-01T00:00:00+08:00',
      actionStart: '2026-09-17T11:00:00+08:00',
      actionEnd: '2026-10-01T00:00:00+08:00',
      withdrawable: '2026-10-01',
    },
  },
];

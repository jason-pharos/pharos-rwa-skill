export type VaultId = 'APC3M' | 'pALPHA';
export type NavSource = 'onchain' | 'api';

/**
 * One chain on which a vault's share/receipt token lives. A vault's total
 * shares = sum of balanceOf across all its balance sources (pALPHA spans
 * Pharos + Ethereum; APC3M has a single Pharos source).
 */
export interface BalanceSource {
  chainId: number;
  rpcUrlEnv?: string;          // env var name to override rpcUrl (e.g. ETHEREUM_RPC_URL)
  rpcUrl: string;              // default RPC for this chain
  token: string;               // ERC20 whose balanceOf = user shares on this chain
  decimals?: number;           // if omitted, read on-chain
}

export interface VaultRegistryEntry {
  id: VaultId;
  displayName: string;
  chainId: number;
  shareToken: string;          // ERC20 whose balanceOf = user shares (primary/Pharos)
  balanceSources: BalanceSource[]; // all chains to sum shares from
  coreVault?: string;          // present when navSource === 'onchain'
  usdc?: string;
  vaultId?: string;            // Pharos vault-info API id (pALPHA)
  navSource: NavSource;
  /**
   * Optional on-chain NAV fallback (ERC4626 convertToAssets). Used when
   * navSource is 'api' but the API is unavailable / returns no price — the
   * receipt token itself is queried on Pharos. `vault` is the ERC4626-style
   * contract (the Pharos receipt token for pALPHA); assetDecimals is the
   * underlying asset's decimals (USDC = 6).
   */
  navOnchainFallback?: {
    vault: string;
    shareDecimals: number;
    assetDecimals: number;
  };
  entryNavBaseline: number;    // epoch-NAV approximation entry price
  apyFallback: number;         // decimal, e.g. 0.14
  actionPeriodConfig: {        // fallback / sole source for APC3M
    lockStart: string;         // ISO8601 with tz
    lockEnd: string;
    actionStart: string;
    actionEnd: string;
    withdrawable: string;      // ISO date
  };
}

export type ActionPeriodSource = 'api' | 'config' | 'unavailable';

export interface ActionPeriod {
  start: string | null;        // ISO8601
  end: string | null;
  startTs: number | null;      // epoch seconds
  endTs: number | null;
  withdrawableDate: string | null;
  source: ActionPeriodSource;
  isOpen: boolean;
  opensInDays: number | null;
  closesInDays: number | null;
  stale: boolean;              // true if config window fully in the past
}

export interface Position {
  vault: VaultId;
  shares: string;              // human-readable decimal string
  nav: number | null;
  currentValue: number | null;
  estimated: boolean;
  assumptions: Record<string, string | number>;
  principal: number | null;
  realizedYield: number | null;
  depositedDurationDays: number | null;
  lockEnd: string | null;
  expectedTotalYield: number | null;
  actionPeriod: ActionPeriod;
}

export interface VaultMarket {
  name: string;
  apy: string;                 // raw string from harbor
  apyValue: number | null;     // parsed decimal, null if unparseable
  tvl: number;
  minimumInvestment: string[];
  assetClass: string;
  topPick: boolean;
  icon: string;
}

export interface AdviceBundle {
  market: VaultMarket[];
  positions: Position[];
  heldVaultIds: VaultId[];
  gapVaults: VaultMarket[];    // open vaults the user does NOT hold
  topPicks: VaultMarket[];
}

export interface UpdateInfo { current: string; latest: string; }

export interface Envelope<T> {
  ok: boolean;
  generatedAt: string;         // ISO8601
  updateAvailable?: UpdateInfo;
  data: T;
  errors: Array<{ scope: string; error: string }>;
}

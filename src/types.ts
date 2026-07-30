export type VaultId = 'APC3M' | 'pALPHA' | 'VRPC-SemiYearly' | 'VRPC-Weekly';

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

/**
 * On-chain NAV source: an ERC4626-style vault whose convertToAssets(1 share)
 * gives the share price. NAV is ALWAYS read on-chain for every vault.
 * - APC3M: the CoreVault contract, asset = USDC.
 * - pALPHA: the Pharos receipt token itself (it is ERC4626-like), asset = USDC.
 */
export interface OnchainNav {
  vault: string;               // ERC4626-style contract to call convertToAssets on
  shareDecimals: number;       // decimals of 1 whole share
  assetDecimals: number;       // decimals of the underlying asset (USDC = 6)
}

export interface VaultRegistryEntry {
  id: VaultId;
  displayName: string;
  chainId: number;
  /**
   * Ember vault UUID. Only vaults tracked by the Ember accounts API have one
   * (pALPHA). When set, position value/yield come from that API (see
   * sources/ember.ts + logic/position-palpha.ts) with the generic on-chain
   * shares × NAV computation as fallback.
   */
  emberVaultId?: string;
  shareToken: string;          // ERC20 whose balanceOf = user shares (primary/Pharos)
  balanceSources: BalanceSource[]; // all chains to sum shares from
  onchainNav: OnchainNav;      // NAV is always read on-chain via convertToAssets
  /**
   * Set for VRPC vaults whose action period has NO fixed global window and no
   * per-user deposit/maturity timestamp on-chain. The action period is derived
   * live from the contract's redeemability (maxRedeem, plus pending/claimable
   * for the ERC-7540 async variant). `vault` is the contract; requestId is the
   * id passed to pending/claimableRedeemRequest (0 for single-request vaults);
   * lockDays is the per-user lock length used only for honest reminder wording
   * (VRPC-SemiYearly = 184, VRPC-Weekly = 7).
   *
   * Both the ERC-7540 async variant (SemiYearly: has pending/claimable) and the
   * plain ERC-4626 sync variant (Weekly: pending/claimable revert → treated as
   * 0) are supported by the same path — getRedeemability tolerates the missing
   * methods.
   */
  redeemability?: {
    vault: string;
    shareDecimals: number;
    requestId: number;
    lockDays: number;
    /** true = ERC-7540 async redeem (SemiYearly); false = ERC-4626 sync (Weekly). */
    async: boolean;
  };
  entryNavBaseline: number;    // epoch-NAV approximation entry price
  apyFallback: number;         // decimal, e.g. 0.14 — APY (registry-maintained, per epoch)
  /**
   * R25 dApp API vault ID. Present only for vaults served by the R25 API
   * (APC3M→"APC3M", VRPC-SemiYearly→"VRPCS", VRPC-Weekly→"VRPCW").
   * Absent for non-R25 vaults (pALPHA) — those use Ember or on-chain only.
   */
  r25VaultId?: string;
  /**
   * Fixed withdraw-window dates (APC3M, pALPHA). Absent for redeemability-based
   * vaults (VRPC-SemiYearly), whose action period comes from the contract.
   */
  actionPeriodConfig?: {
    lockStart: string;         // ISO8601 with tz
    lockEnd: string;
    actionStart: string;
    actionEnd: string;
    withdrawable: string;      // ISO date
  };
}

export type ActionPeriodSource = 'config' | 'onchain-redeemable' | 'r25-api' | 'unavailable';

/**
 * Live redeemability of a VRPC vault, in place of fixed window dates. Covers
 * both the ERC-7540 async variant (pending/claimable populated) and the plain
 * ERC-4626 sync variant (pending/claimable stay 0 — those methods don't exist).
 * All share/value amounts are human-readable numbers.
 */
export interface Redeemable {
  maxRedeemShares: number;      // shares currently redeemable (maxRedeem)
  maxRedeemValue: number | null;// maxRedeemShares × NAV (USD), null if NAV unknown
  pendingRedeemShares: number;  // shares in a submitted-but-not-settled request (async only)
  claimableRedeemShares: number;// shares whose redeem has settled and can be claimed (async only)
  fullyRedeemable: boolean;     // maxRedeemShares >= total held shares
  lockDays: number;             // per-user lock length in days (wording only)
  /** true = ERC-7540 async (redeem must be REQUESTED first, then settled, then
   * claimed — SemiYearly); false = ERC-4626 sync (redeem directly — Weekly). */
  async: boolean;
}

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
  /** Present only when source === 'onchain-redeemable' (VRPC-SemiYearly). */
  redeemable?: Redeemable;
}

/**
 * Yield split reported by the Ember accounts API (USD).
 *  - realized:   yield already crystallised (withdrawn/settled)
 *  - unrealized: yield still sitting in the position
 *  - total:      realized + unrealized == Position.realizedYield
 */
export interface YieldBreakdown {
  realized: number;
  unrealized: number;
  total: number;
}

/** Boost / incentive info from the R25 holdings API (e.g. TopNod sponsor). */
export interface R25BoostInfo {
  boostApy: number;            // extra APY as decimal (e.g. 0.03 = 3%)
  yesterdayEarnings: number;
  totalBoostEarnings: number;
  validUntil: string | null;   // ISO date
  sponsor: string;
}

/** One deposit tranche within a vault position (from R25 positions API). */
export interface R25Tranche {
  shares: number;
  amountUsdc: number;
  expirationDate: string;      // ISO date (e.g. "2026-11-30")
  expirationTs: number;        // epoch seconds
  daysUntilExpiration: number;
  expired: boolean;
}

/** Real (non-estimated) position data from the R25 holdings API. */
export interface R25HoldingInfo {
  earnings: number;            // totalEarnings — actual yield, not estimated
  fiatEarnings: number;
  baseApy: number;             // base APY from R25 (before boost)
  boost: R25BoostInfo | null;
  hasRedeemRequest: boolean | null;
  /** Per-tranche breakdown (APC3M, VRPCS only). Each tranche = one deposit
   *  with its own lock expiration. Absent for VRPCW (unsupported by API). */
  tranches?: R25Tranche[];
  /** Freeze window (ms) before a redeem request can be settled (VRPCS). */
  redemptionFreezeWindowMs?: number;
}

export interface Position {
  vault: VaultId;
  shares: string;              // human-readable decimal string
  nav: number | null;
  currentValue: number | null;
  estimated: boolean;
  assumptions: Record<string, string | number>;
  principal: number | null;
  /** Yield earned so far = currentValue − principal (== yieldBreakdown.total). */
  realizedYield: number | null;
  /** Only present when the value came from the Ember accounts API (pALPHA). */
  yieldBreakdown?: YieldBreakdown;
  depositedDurationDays: number | null;
  lockEnd: string | null;
  expectedTotalYield: number | null;
  actionPeriod: ActionPeriod;
  /** Present only for R25 vaults with API data (holdings endpoint). */
  r25?: R25HoldingInfo;
}

export interface VaultMarket {
  name: string;
  apy: string;                 // raw string from harbor (includes TopNod boost when available)
  apyValue: number | null;     // parsed decimal, null if unparseable
  tvl: number;
  minimumInvestment: string[];
  assetClass: string;
  topPick: boolean;
  icon: string;
  /**
   * Base APY from the R25 dApp API (decimal, e.g. 0.13). This is the rate
   * before any TopNod boost — buying directly on the R25 website earns this.
   * The harbor `apy`/`apyValue` above may include a TopNod boost (higher).
   * Present only for R25 vaults.
   */
  r25BaseApy?: number;
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

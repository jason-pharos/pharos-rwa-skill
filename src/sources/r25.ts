/**
 * R25 dApp API client (https://app.r25.xyz/dapp/*).
 *
 * All endpoints are POST, public (no auth/cookie needed), and rate-limited —
 * requests that arrive too fast get "System busy" (R0005_00001). This client
 * serialises calls with a minimum interval to stay under the limit.
 *
 * Failures throw with the reason the API gave, so callers can record WHY they
 * fell back to on-chain reads. This matters because the API validates
 * `x-timestamp`: a host with a skewed clock gets 401 "Timestamp invalid"
 * (R0003_00001) on every single call, which is indistinguishable from an outage
 * unless the message is surfaced.
 */

const R25_BASE = 'https://app.r25.xyz/dapp';
const MIN_INTERVAL_MS = 1200;
/**
 * Per-request timeout. Kept well under the caller's overall R25 deadline (see
 * R25_DEADLINE_MS in index.ts) so a blocked host cannot stack several requests
 * past it — these calls are serialised behind MIN_INTERVAL_MS, so their waits
 * add up rather than overlap.
 */
const TIMEOUT_MS = 4000;

let lastRequestAt = 0;

async function r25Post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + MIN_INTERVAL_MS - now);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  let res: Response;
  try {
    res = await fetch(`${R25_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-currency': 'USD',
        'x-language': 'en-US',
        'x-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-timezone': 'Asia/Hong_Kong',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new Error(name === 'TimeoutError' || name === 'AbortError'
      ? `${path}: no response within ${TIMEOUT_MS}ms`
      : `${path}: ${String((e as Error)?.message ?? e)}`);
  }

  // Read the body even on a non-2xx: the API puts its reason there (e.g. 401
  // with "Timestamp invalid", which points at a clock-skewed host).
  const json = await res.json().catch(() => null) as { success?: boolean; code?: string; message?: string; data?: T } | null;
  if (!res.ok || !json?.success) {
    const detail = json?.message ? `${json.message}${json.code ? ` (${json.code})` : ''}` : `HTTP ${res.status}`;
    throw new Error(`${path}: ${detail}`);
  }
  return json.data ?? null;
}

// ── API response types ──────────────────────────────────────────────

export interface R25VaultListItem {
  vaultId: string;
  name: string;
  symbol: string;
  tvl: string;          // decimal string
  apy: string;          // decimal string (e.g. "0.13")
  yieldType: string;
  chainName: string;
}

export interface R25HoldingBoost {
  boostApy: string;
  yesterdayEarnings: string;
  totalBoostEarnings: string;
  validUntil: number;   // ms epoch
  sponsor: string;
  unit: string;
}

export interface R25HoldingItem {
  vaultId: string;
  name: string;
  symbol: string;
  shares: string;
  totalEarnings: string;
  fiatEarnings: string;
  nav: string;
  yieldType: string;
  apy: string;
  navDailyChange: string | null;
  chainName: string;
  tokenAddress: string;
  windowType: string;           // "REDEMPTION" | "NORMAL"
  subscriptionMode: string;     // "WINDOWED" | "OPEN"
  maturityDate: number | null;  // ms epoch
  tips: string | null;
  boostInfo: R25HoldingBoost | null;
  hasRedeemRequest: boolean | null;
}

export interface R25VaultPeriod {
  preDepositWindowStart: number | null;
  preDepositWindowEnd: number | null;
  lockStart: number | null;
  nextMaturityDate: number | null;
  withdrawalWindowStart: number | null;
  withdrawalWindowEnd: number | null;
}

export interface R25VaultStatus {
  tradeable: boolean;
  redeemable: boolean;
  reason: string | null;
  reasonDesc: string | null;
}

export interface R25VaultCapacity {
  ratio: string;
  used: string;
  total: string;
  unit: string;
}

export interface R25PositionTranche {
  amountUsdc: string;
  shares: string;
  symbol: string;
  expirationDate: number;    // ms epoch
}

export interface R25Positions {
  availableCount: number;
  withdrawalCount: number;
  available: R25PositionTranche[];
  withdrawals: unknown[];
  totalBalance: number;
  redemptionFreezeWindow: number;  // ms
}

export interface R25ActivityItem {
  vaultId: string;
  txType: string;    // "DEPOSIT" | "WITHDRAW" | etc
  amount: string;    // deposit asset amount (USDC for supported vaults)
  txTime: number;    // ms epoch
  status: string;
}

export interface R25ActivityResponse {
  data: R25ActivityItem[];
  pageNum: number;
  pageSize: number;
  total: number;
  pages: number;
}

// ── Public API ──────────────────────────────────────────────────────

/** All R25 vaults with TVL / APY. No address needed. */
export function fetchR25VaultList(): Promise<R25VaultListItem[] | null> {
  return r25Post('/vault/list', {});
}

/** User holdings across all R25 vaults (shares, real earnings, boost). */
export function fetchR25Holdings(address: string): Promise<R25HoldingItem[] | null> {
  return r25Post('/portfolio/holdings', { address });
}

/** Window / lock / maturity timestamps (ms) for a WINDOWED vault (APC3M). */
export function fetchR25VaultPeriod(vaultId: string): Promise<R25VaultPeriod | null> {
  return r25Post('/vault/period', { vaultId });
}

/** Live deposit / redeem availability for a vault. */
export function fetchR25VaultStatus(vaultId: string): Promise<R25VaultStatus | null> {
  return r25Post('/vault/status', { vaultId });
}

/** Capacity (used / total) for a vault. */
export function fetchR25VaultCapacity(vaultId: string): Promise<R25VaultCapacity | null> {
  return r25Post('/vault/capacity', { vaultId });
}

/**
 * Per-tranche position breakdown for a vault (APC3M and VRPCS only —
 * VRPCW returns "Unsupported vault"). Each tranche is one deposit with
 * its own expiration date.
 */
export function fetchR25Positions(address: string, vaultId: string): Promise<R25Positions | null> {
  return r25Post('/portfolio/positions', { address, vaultId });
}

/**
 * All portfolio activity (deposits, withdrawals) across every vault. Used as
 * a fallback source for vaults where `/portfolio/positions` returns
 * "Unsupported vault" (VRPCW). Each deposit record includes the amount and
 * timestamp, from which per-tranche unlock dates can be derived (see
 * `deriveVRPCWTranches` in index.ts).
 */
export function fetchR25Activity(address: string, pageSize?: number): Promise<R25ActivityResponse | null> {
  return r25Post('/portfolio/activity', { address, pageSize: pageSize ?? 50 });
}

import type { AdviceBundle, Envelope, Position, R25HoldingInfo, UpdateInfo, VaultMarket, VaultRegistryEntry } from './types.ts';
import { loadRegistry } from './config/remoteConfig.ts';
import { fetchHarbor } from './sources/harbor.ts';
import { fetchR25VaultList, fetchR25Holdings, fetchR25VaultPeriod, fetchR25Positions, fetchR25Activity, type R25HoldingItem, type R25VaultPeriod, type R25Positions, type R25ActivityItem } from './sources/r25.ts';
import { DEFAULT_RPC, DEFAULT_CHAIN_ID, makeProvider, getVaultShares, getVaultNavOnchain, getRedeemability, type RawRedeemability } from './sources/chain.ts';
import { resolveActionPeriod, resolveRedeemableActionPeriod, resolveR25ActionPeriod, resolveR25TrancheActionPeriod } from './logic/actionPeriod.ts';
import { computePosition } from './logic/position.ts';
import { computePAlphaPosition } from './logic/position-palpha.ts';
import { fetchEmberPositionValue } from './sources/ember.ts';
import { buildReminders, type Reminder } from './logic/reminders.ts';
import { buildAdvice } from './logic/advise.ts';
import { checkForUpdate } from './update/checkVersion.ts';
import { selfUpdate } from './update/selfUpdate.ts';
import { nowSec } from './util/time.ts';

export interface RunOpts { rpc?: string; noRemote: boolean; now?: number }

export function makeEnvelope<T>(data: T, errors: Envelope<T>['errors'], updateAvailable?: UpdateInfo): Envelope<T> {
  const env: Envelope<T> = { ok: errors.length === 0, generatedAt: new Date().toISOString(), data, errors };
  if (updateAvailable) env.updateAvailable = updateAvailable;
  return env;
}

async function safeUpdate(opts: RunOpts): Promise<UpdateInfo | undefined> {
  try { return await checkForUpdate({ noRemote: opts.noRemote }); } catch { return undefined; }
}

function providerFor(opts: RunOpts) {
  return makeProvider(opts.rpc ?? process.env.PHAROS_RPC_URL ?? DEFAULT_RPC, DEFAULT_CHAIN_ID);
}

/**
 * Enrich harbor market data with R25 API data for R25 vaults.
 *  - TVL: overridden with live R25 value (more accurate).
 *  - APY: harbor APY (includes TopNod boost) is KEPT as primary;
 *    R25 base APY is added as `r25BaseApy` so users can compare.
 */
async function enrichWithR25(vaults: VaultMarket[], opts: RunOpts): Promise<void> {
  try {
    const registry = await loadRegistry({ noRemote: opts.noRemote });
    const r25List = await fetchR25VaultList();
    if (!r25List) return;
    const r25Map = new Map(r25List.map((v) => [v.vaultId, v]));
    for (const entry of registry) {
      if (!entry.r25VaultId) continue;
      const r25 = r25Map.get(entry.r25VaultId);
      if (!r25) continue;
      const market = vaults.find((m) => m.name === entry.id || m.name === entry.r25VaultId);
      if (market) {
        market.tvl = Number(r25.tvl) || market.tvl;
        const baseApy = Number(r25.apy);
        if (Number.isFinite(baseApy)) market.r25BaseApy = baseApy;
      }
    }
  } catch { /* R25 enrichment is best-effort; harbor data still valid */ }
}

export async function runVaults(opts: RunOpts): Promise<Envelope<{ vaults: VaultMarket[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  let vaults: VaultMarket[] = [];
  try { vaults = await fetchHarbor(); } catch (e) { errors.push({ scope: 'harbor', error: String((e as Error).message ?? e) }); }
  await enrichWithR25(vaults, opts);
  return makeEnvelope({ vaults }, errors, await safeUpdate(opts));
}

type NavResult = { nav: number | null; apy: number; navResolvedFrom: 'onchain' | 'none' };

/**
 * Resolve NAV + APY for one vault.
 *  - NAV is ALWAYS read on-chain (ERC4626 convertToAssets via entry.onchainNav).
 *    A read failure degrades to nav:null (position still shows shares/principal)
 *    rather than dropping the whole position.
 *  - APY comes from the registry (entry.apyFallback), maintained per epoch via
 *    remote config. The vault-info API is no longer used here — its data is
 *    mostly unmaintained, and everything position needs is on-chain or in the
 *    registry.
 * Action period comes solely from actionPeriodConfig (see resolveActionPeriod).
 */
async function navFor(entry: VaultRegistryEntry, provider: ReturnType<typeof makeProvider>): Promise<NavResult> {
  const { vault, shareDecimals, assetDecimals } = entry.onchainNav;
  try {
    const nav = await getVaultNavOnchain(vault, shareDecimals, assetDecimals, provider);
    return { nav, apy: entry.apyFallback, navResolvedFrom: 'onchain' };
  } catch {
    // NAV read failed → degrade gracefully; principal/shares still reported.
    return { nav: null, apy: entry.apyFallback, navResolvedFrom: 'none' };
  }
}

/** Convert raw R25 holdings API item to our internal R25HoldingInfo. */
function toR25HoldingInfo(h: R25HoldingItem, positionsData?: R25Positions | null, nowMs?: number): R25HoldingInfo {
  const info: R25HoldingInfo = {
    earnings: Number(h.totalEarnings) || 0,
    fiatEarnings: Number(h.fiatEarnings) || 0,
    baseApy: Number(h.apy) || 0,
    boost: h.boostInfo ? {
      boostApy: Number(h.boostInfo.boostApy) || 0,
      yesterdayEarnings: Number(h.boostInfo.yesterdayEarnings) || 0,
      totalBoostEarnings: Number(h.boostInfo.totalBoostEarnings) || 0,
      validUntil: h.boostInfo.validUntil ? new Date(h.boostInfo.validUntil).toISOString().slice(0, 10) : null,
      sponsor: h.boostInfo.sponsor,
    } : null,
    hasRedeemRequest: h.hasRedeemRequest,
  };
  // Attach per-tranche breakdown when available (APC3M, VRPCS).
  if (positionsData && positionsData.available.length > 0) {
    const now = nowMs ?? Date.now();
    info.tranches = positionsData.available.map((t) => {
      const expMs = t.expirationDate;
      const expSec = Math.floor(expMs / 1000);
      const days = Math.round((expMs - now) / 86400000);
      return {
        shares: Number(t.shares) || 0,
        amountUsdc: Number(t.amountUsdc) || 0,
        expirationDate: new Date(expMs).toISOString().slice(0, 10),
        expirationTs: expSec,
        daysUntilExpiration: days,
        expired: expMs <= now,
      };
    }).sort((a, b) => a.expirationTs - b.expirationTs);
    if (positionsData.redemptionFreezeWindow > 0) {
      info.redemptionFreezeWindowMs = positionsData.redemptionFreezeWindow;
    }
  }
  return info;
}

/**
 * Derive per-deposit tranches from portfolio activity data for vaults whose
 * `/portfolio/positions` API returns "Unsupported vault" (VRPCW).
 * Allocates total shares proportionally by deposit amount and computes
 * lock-end dates as deposit time + lockDays.
 */
function derivePositionsFromActivity(
  vaultId: string,
  items: R25ActivityItem[],
  totalShares: number,
  lockDays: number,
): R25Positions | null {
  const deposits = items.filter((i) => i.vaultId === vaultId && i.txType === 'DEPOSIT');
  if (deposits.length === 0) return null;

  const totalDeposit = deposits.reduce((s, d) => s + Number(d.amount), 0);
  if (totalDeposit <= 0) return null;

  const lockMs = lockDays * 86400000;
  const available = deposits.map((d) => ({
    amountUsdc: d.amount,
    shares: String(totalShares * (Number(d.amount) / totalDeposit)),
    symbol: vaultId,
    expirationDate: d.txTime + lockMs,
  }));

  return {
    availableCount: available.length,
    withdrawalCount: 0,
    available,
    withdrawals: [],
    totalBalance: totalShares,
    redemptionFreezeWindow: 0, // ERC-4626 sync — no freeze
  };
}

async function buildPositions(address: string, opts: RunOpts, errors: Envelope<unknown>['errors']): Promise<Position[]> {
  const registry = await loadRegistry({ noRemote: opts.noRemote });
  const provider = providerFor(opts);
  const now = opts.now ?? nowSec();
  const positions: Position[] = [];

  // ── Pre-fetch R25 API data (rate-limited, before parallel on-chain reads) ──
  const hasR25Vaults = registry.some((e) => e.r25VaultId);
  let r25Holdings: Map<string, R25HoldingItem> | null = null;
  const r25Periods = new Map<string, R25VaultPeriod>();
  const r25Positions = new Map<string, R25Positions>();

  if (hasR25Vaults) {
    try {
      const holdings = await fetchR25Holdings(address);
      if (holdings) r25Holdings = new Map(holdings.map((h) => [h.vaultId, h]));
    } catch { /* fall back to on-chain */ }

    // Fetch dynamic action-period dates for WINDOWED R25 vaults (APC3M).
    for (const entry of registry) {
      if (entry.r25VaultId && entry.actionPeriodConfig) {
        try {
          const period = await fetchR25VaultPeriod(entry.r25VaultId);
          if (period) r25Periods.set(entry.r25VaultId, period);
        } catch { /* fall back to config dates */ }
      }
    }

    // Fetch per-tranche positions for R25 vaults the user holds.
    // VRPCW returns "Unsupported vault" — fall back to activity-derived
    // tranches using deposit records from /portfolio/activity.
    if (r25Holdings) {
      const missingPositions: string[] = [];
      for (const entry of registry) {
        if (!entry.r25VaultId || !r25Holdings.has(entry.r25VaultId)) continue;
        try {
          const pos = await fetchR25Positions(address, entry.r25VaultId);
          if (pos) {
            r25Positions.set(entry.r25VaultId, pos);
          } else {
            missingPositions.push(entry.r25VaultId);
          }
        } catch {
          missingPositions.push(entry.r25VaultId);
        }
      }
      // Fall back to activity-derived tranches for vaults without positions
      // API support (VRPCW).
      if (missingPositions.length > 0) {
        try {
          const activity = await fetchR25Activity(address);
          if (activity && activity.data.length > 0) {
            for (const vid of missingPositions) {
              const entry = registry.find((e) => e.r25VaultId === vid);
              const r25h = r25Holdings.get(vid);
              if (!entry || !r25h) continue;
              const lockDays = entry.redeemability?.lockDays;
              if (!lockDays) continue;
              const derived = derivePositionsFromActivity(vid, activity.data, Number(r25h.shares), lockDays);
              if (derived) r25Positions.set(vid, derived);
            }
          }
        } catch { /* activity is best-effort */ }
      }
    }
  }

  await Promise.allSettled(registry.map(async (entry) => {
    try {
      // Sum share/receipt-token balance across ALL of the vault's chains
      // (pALPHA = Pharos + Ethereum; APC3M = Pharos only). The --rpc/opts.rpc
      // override applies to the Pharos chain (its documented meaning).
      const rpcOverrides = opts.rpc ? { [DEFAULT_CHAIN_ID]: opts.rpc } : {};
      const shares = await getVaultShares(entry.balanceSources, address, rpcOverrides);
      // Surface per-chain balance-read failures without dropping the position.
      for (const be of shares.errors) {
        errors.push({ scope: `${entry.id}:chain-${be.chainId}`, error: be.error });
      }

      // R25 holdings for this vault (undefined if not an R25 vault or no data).
      const r25h = entry.r25VaultId ? r25Holdings?.get(entry.r25VaultId) : undefined;
      const hasR25PositionData = entry.r25VaultId ? r25Positions.has(entry.r25VaultId) : false;
      // ERC-7540 async vaults (VRPCS): R25 positions data overrides on-chain
      // maxRedeem which is misleading (returns only first settlement window).
      // ERC-4626 sync vaults (APC3M, VRPCW): on-chain maxRedeem is correct;
      // R25 positions/tranches are for display only.
      const useR25ActionPeriod = hasR25PositionData && (entry.redeemability?.async === true);

      // Redeemability (ERC-7540, VRPC-SemiYearly): read BEFORE the zero-balance
      // skip. SKIP the on-chain read when R25 positions data is available for
      // ERC-7540 async vaults — the API is authoritative for withdrawal eligibility
      // (maxRedeem on-chain is misleading for ERC-7540, returning only the first
      // settlement window's shares).
      let rawRedeem: RawRedeemability | undefined;
      if (entry.redeemability && !useR25ActionPeriod) {
        try {
          rawRedeem = await getRedeemability(entry.redeemability.vault, address, entry.redeemability.requestId, entry.redeemability.shareDecimals, provider);
        } catch (e) {
          errors.push({ scope: `${entry.id}:redeemability`, error: String((e as Error).message ?? e) });
        }
      }
      const hasRedeemActivity = rawRedeem != null
        && (rawRedeem.pendingRedeemShares > 0 || rawRedeem.claimableRedeemShares > 0 || rawRedeem.maxRedeemShares > 0);

      if (shares.totalRaw === 0n && !hasRedeemActivity && !r25h) return; // truly nothing to report

      // NAV + APY: R25 API first, on-chain fallback.
      let nav: number | null;
      let apy: number;
      let navResolvedFrom: string;
      if (r25h) {
        nav = Number(r25h.nav) || null;
        // Effective APY = base APY + boost APY (e.g. TopNod +3%).
        // The boost is what the user actually earns through their purchase channel.
        const baseApy = Number(r25h.apy) || entry.apyFallback;
        const boostApy = r25h.boostInfo ? (Number(r25h.boostInfo.boostApy) || 0) : 0;
        apy = baseApy + boostApy;
        navResolvedFrom = 'r25-api';
      } else {
        const result = await navFor(entry, provider);
        nav = result.nav;
        apy = result.apy;
        navResolvedFrom = result.navResolvedFrom;
      }

      // Action period: R25 positions/tranche data for ERC-7540 async vaults
      // (all non-expired shares requestable); else on-chain redeemability; else
      // R25 period API for WINDOWED vaults (APC3M); else config dates.
      let actionPeriod;
      if (useR25ActionPeriod) {
        const totalShares = r25h ? Number(r25h.shares) : Number(shares.totalHuman);
        actionPeriod = resolveR25TrancheActionPeriod(r25Positions.get(entry.r25VaultId!)!, totalShares, nav, entry.redeemability!.lockDays, entry.redeemability!.async, now);
      } else if (rawRedeem != null) {
        actionPeriod = resolveRedeemableActionPeriod(rawRedeem, Number(shares.totalHuman), nav, entry.redeemability!.lockDays, entry.redeemability!.async);
      } else if (entry.r25VaultId && r25Periods.has(entry.r25VaultId)) {
        actionPeriod = resolveR25ActionPeriod(r25Periods.get(entry.r25VaultId)!, now);
      } else {
        actionPeriod = resolveActionPeriod(entry, now);
      }

      // For ERC-7540 vaults, requestRedeem escrows shares OUT of the wallet, so
      // the holder's TOTAL position = wallet shares + escrowed (pending +
      // claimable). Use that total for value/principal so a mid-redemption
      // position isn't understated. When R25 positions data is available for
      // ERC-7540 async vaults, use the R25 total shares (includes all tranches).
      let effectiveShares: string;
      if (useR25ActionPeriod && r25h) {
        effectiveShares = r25h.shares;
      } else {
        const escrowedShares = rawRedeem != null ? rawRedeem.pendingRedeemShares + rawRedeem.claimableRedeemShares : 0;
        effectiveShares = (Number(shares.totalHuman) + escrowedShares).toString();
      }

      const common = { entry, sharesHuman: effectiveShares, nav, apy, actionPeriod, now, navResolvedFrom };

      // Vaults tracked by the Ember accounts API (pALPHA) get their value and
      // yield split from there; every other vault uses shares × NAV. An API
      // failure is surfaced but degrades to the on-chain computation.
      if (entry.emberVaultId) {
        try {
          const emberPosition = await fetchEmberPositionValue(address, entry.emberVaultId);
          if (emberPosition) {
            positions.push(computePAlphaPosition({ ...common, emberPosition }));
            return;
          }
        } catch (e) {
          errors.push({ scope: `${entry.id}:ember`, error: String((e as Error).message ?? e) });
        }
      }

      // R25 vaults with API data get real earnings (not estimated).
      if (r25h) {
        const posData = entry.r25VaultId ? r25Positions.get(entry.r25VaultId) : undefined;
        positions.push(computePosition({ ...common, r25Holding: toR25HoldingInfo(r25h, posData) }));
      } else {
        positions.push(computePosition(common));
      }
    } catch (e) {
      errors.push({ scope: entry.id, error: String((e as Error).message ?? e) });
    }
  }));

  return positions.sort((a, b) => a.vault.localeCompare(b.vault));
}

export async function runPosition(address: string, opts: RunOpts): Promise<Envelope<{ address: string; positions: Position[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope({ address, positions }, errors, await safeUpdate(opts));
}

export async function runReminders(address: string, opts: RunOpts): Promise<Envelope<{ address: string; reminders: Reminder[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope({ address, reminders: buildReminders(positions) }, errors, await safeUpdate(opts));
}

export async function runAdvise(address: string, opts: RunOpts): Promise<Envelope<AdviceBundle>> {
  const errors: Envelope<unknown>['errors'] = [];
  let market: VaultMarket[] = [];
  try { market = await fetchHarbor(); } catch (e) { errors.push({ scope: 'harbor', error: String((e as Error).message ?? e) }); }
  await enrichWithR25(market, opts);
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope(buildAdvice(market, positions), errors, await safeUpdate(opts));
}

export async function runUpgrade(): Promise<Envelope<{ upgraded: boolean; from: string; to: string; note?: string }>> {
  const errors: Envelope<unknown>['errors'] = [];
  try {
    const r = await selfUpdate({});
    return makeEnvelope(r, errors);
  } catch (e) {
    errors.push({ scope: 'upgrade', error: String((e as Error).message ?? e) });
    return makeEnvelope({ upgraded: false, from: '', to: '' }, errors);
  }
}

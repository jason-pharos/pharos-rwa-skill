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
import { selfUpdate, type UpgradeResult } from './update/selfUpdate.ts';
import { nowSec } from './util/time.ts';

export interface RunOpts {
  rpc?: string;
  noRemote: boolean;
  now?: number;
  /** Cap on how long R25-dependent vaults wait for the R25 pre-fetch. Tests
   *  shorten this; production uses R25_DEADLINE_MS. */
  r25DeadlineMs?: number;
}

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
async function navFor(entry: VaultRegistryEntry, provider: ReturnType<typeof makeProvider>, deps: PositionDeps): Promise<NavResult> {
  const { vault, shareDecimals, assetDecimals } = entry.onchainNav;
  try {
    const nav = await deps.getVaultNavOnchain(vault, shareDecimals, assetDecimals, provider);
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

/**
 * Everything buildPositions reaches the network through. Defaults are the real
 * clients; tests inject fakes to assert ordering and outage behaviour without
 * wall-clock sleeps.
 */
export interface PositionDeps {
  registry?: VaultRegistryEntry[];
  getVaultShares: typeof getVaultShares;
  getVaultNavOnchain: typeof getVaultNavOnchain;
  getRedeemability: typeof getRedeemability;
  fetchEmberPositionValue: typeof fetchEmberPositionValue;
  fetchR25Holdings: typeof fetchR25Holdings;
  fetchR25VaultPeriod: typeof fetchR25VaultPeriod;
  fetchR25Positions: typeof fetchR25Positions;
  fetchR25Activity: typeof fetchR25Activity;
}

const DEFAULT_DEPS: PositionDeps = {
  getVaultShares, getVaultNavOnchain, getRedeemability, fetchEmberPositionValue,
  fetchR25Holdings, fetchR25VaultPeriod, fetchR25Positions, fetchR25Activity,
};

/**
 * Cap on how long the R25 pre-fetch may hold up vaults that depend on it.
 * R25 calls are serialised behind a 1.2s rate limit and each has its own 12s
 * timeout, so a blocked host could stack six of them into ~63s. Vaults that
 * need no R25 data never wait on this at all (see buildPositions); this bounds
 * the wait for the ones that do.
 */
const R25_DEADLINE_MS = 8000;

/**
 * Resolve `work`, or give up after `ms` and return null. The abandoned promise
 * is left to settle on its own — its rejection is swallowed so an outage cannot
 * surface as an unhandled rejection.
 */
async function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = Symbol('expired');
  try {
    work.catch(() => { /* reported by the caller that races it, or dropped */ });
    const raced = await Promise.race([
      work,
      new Promise<typeof expired>((r) => { timer = setTimeout(() => r(expired), ms); }),
    ]);
    return raced === expired ? null : (raced as T);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * All R25 data for one address, fetched as a single unit behind a deadline.
 *
 * Kept separate from the per-vault work so that vaults with no `r25VaultId`
 * (pALPHA) never await it. Within this function the calls stay sequential on
 * purpose: `r25Post` enforces a global 1.2s minimum interval, so issuing them
 * concurrently would not make them arrive any sooner.
 */
async function fetchR25Data(
  address: string,
  registry: VaultRegistryEntry[],
  deps: PositionDeps,
  errors: Envelope<unknown>['errors'],
): Promise<{ holdings: Map<string, R25HoldingItem> | null; periods: Map<string, R25VaultPeriod>; positions: Map<string, R25Positions> }> {
  const periods = new Map<string, R25VaultPeriod>();
  const positions = new Map<string, R25Positions>();
  let holdings: Map<string, R25HoldingItem> | null = null;

  // An R25 failure is not fatal (every vault degrades to on-chain reads) but it
  // must not be silent: a stale clock alone makes every call 401
  // "Timestamp invalid", which used to leave errors[] empty and the numbers
  // quietly falling back.
  const note = (path: string, e: unknown) => {
    errors.push({ scope: `r25:${path}`, error: String((e as Error)?.message ?? e) });
  };

  try {
    const list = await deps.fetchR25Holdings(address);
    if (list) holdings = new Map(list.map((h) => [h.vaultId, h]));
    else note('portfolio/holdings', 'no data (API error, rate limit, or timeout)');
  } catch (e) { note('portfolio/holdings', e); }

  // Dynamic action-period dates for WINDOWED R25 vaults (APC3M).
  for (const entry of registry) {
    if (!entry.r25VaultId || !entry.actionPeriodConfig) continue;
    try {
      const period = await deps.fetchR25VaultPeriod(entry.r25VaultId);
      if (period) periods.set(entry.r25VaultId, period);
    } catch (e) { note(`vault/period:${entry.r25VaultId}`, e); }
  }

  // Per-tranche positions for R25 vaults the user holds. VRPCW returns
  // "Unsupported vault" — fall back to activity-derived tranches.
  if (holdings) {
    const missing: string[] = [];
    for (const entry of registry) {
      if (!entry.r25VaultId || !holdings.has(entry.r25VaultId)) continue;
      try {
        const pos = await deps.fetchR25Positions(address, entry.r25VaultId);
        if (pos) positions.set(entry.r25VaultId, pos);
        else missing.push(entry.r25VaultId);
      } catch {
        // Expected for VRPCW ("Unsupported vault"); the activity fallback below
        // covers it, so this is not an error worth surfacing.
        missing.push(entry.r25VaultId);
      }
    }
    if (missing.length > 0) {
      try {
        const activity = await deps.fetchR25Activity(address);
        if (activity && activity.data.length > 0) {
          for (const vid of missing) {
            const entry = registry.find((e) => e.r25VaultId === vid);
            const holding = holdings.get(vid);
            const lockDays = entry?.redeemability?.lockDays;
            if (!entry || !holding || !lockDays) continue;
            const derived = derivePositionsFromActivity(vid, activity.data, Number(holding.shares), lockDays);
            if (derived) positions.set(vid, derived);
          }
        }
      } catch { /* activity is best-effort; tranches are display-only */ }
    }
  }

  return { holdings, periods, positions };
}

export async function buildPositions(
  address: string,
  opts: RunOpts,
  errors: Envelope<unknown>['errors'],
  depsOverride?: Partial<PositionDeps>,
): Promise<Position[]> {
  const deps: PositionDeps = { ...DEFAULT_DEPS, ...depsOverride };
  const registry = deps.registry ?? await loadRegistry({ noRemote: opts.noRemote });
  const provider = providerFor(opts);
  const now = opts.now ?? nowSec();
  const positions: Position[] = [];

  // The R25 pre-fetch starts here but is NOT awaited: it used to be a serial
  // gate in front of every vault, which stranded pALPHA — a vault that needs no
  // R25 data whatsoever — behind up to six stacked 12s R25 timeouts. Only the
  // vaults that actually carry an `r25VaultId` await it, and even they give up
  // at the deadline rather than inheriting the full stack.
  const needsR25 = registry.some((e) => e.r25VaultId);
  const r25DeadlineMs = opts.r25DeadlineMs ?? R25_DEADLINE_MS;
  const r25Ready: Promise<Awaited<ReturnType<typeof fetchR25Data>> | null> = needsR25
    ? withDeadline(fetchR25Data(address, registry, deps, errors), r25DeadlineMs)
        .then((data) => {
          // Hitting the deadline abandons the in-flight call, so whatever it
          // would have reported never lands — record the giving-up here instead,
          // otherwise an unreachable R25 host degrades every R25 vault silently.
          if (data == null) {
            errors.push({ scope: 'r25', error: `R25 API did not respond within ${r25DeadlineMs}ms; R25 vaults fall back to on-chain reads` });
          }
          return data;
        })
    : Promise.resolve(null);
  // Nothing else observes this promise when it rejects; keep it from surfacing
  // as an unhandled rejection.
  r25Ready.catch(() => {});

  await Promise.allSettled(registry.map(async (entry) => {
    try {
      // Sum share/receipt-token balance across ALL of the vault's chains
      // (pALPHA = Pharos + Ethereum; APC3M = Pharos only). The --rpc/opts.rpc
      // override applies to the Pharos chain (its documented meaning).
      const rpcOverrides = opts.rpc ? { [DEFAULT_CHAIN_ID]: opts.rpc } : {};
      const shares = await deps.getVaultShares(entry.balanceSources, address, rpcOverrides);
      // Surface per-chain balance-read failures without dropping the position.
      for (const be of shares.errors) {
        errors.push({ scope: `${entry.id}:chain-${be.chainId}`, error: be.error });
      }
      // Every chain failed → the wallet balance is unknown, which is not the
      // same as zero. Distinguishing the two decides whether an off-chain value
      // source can still carry the position (see emberPosition below).
      const sharesUnknown = shares.sources.length === 0 && shares.errors.length > 0;

      // Ember (pALPHA) is this vault's own book of record and independent of
      // both the chain reads and R25, so start it now rather than after them.
      const emberPending = entry.emberVaultId
        ? deps.fetchEmberPositionValue(address, entry.emberVaultId)
            .catch((e): null => {
              errors.push({ scope: `${entry.id}:ember`, error: String((e as Error).message ?? e) });
              return null;
            })
        : null;

      // Only R25 vaults wait for the R25 pre-fetch.
      const r25Data = entry.r25VaultId ? await r25Ready : null;
      const r25h = entry.r25VaultId ? r25Data?.holdings?.get(entry.r25VaultId) : undefined;
      const r25Periods = r25Data?.periods;
      const r25Positions = r25Data?.positions;
      const hasR25PositionData = entry.r25VaultId ? r25Positions?.has(entry.r25VaultId) === true : false;
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
          rawRedeem = await deps.getRedeemability(entry.redeemability.vault, address, entry.redeemability.requestId, entry.redeemability.shareDecimals, provider);
        } catch (e) {
          errors.push({ scope: `${entry.id}:redeemability`, error: String((e as Error).message ?? e) });
        }
      }
      const hasRedeemActivity = rawRedeem != null
        && (rawRedeem.pendingRedeemShares > 0 || rawRedeem.claimableRedeemShares > 0 || rawRedeem.maxRedeemShares > 0);

      const emberPosition = emberPending ? await emberPending : null;

      // Nothing anywhere knows of a holding → genuinely empty. Ember counts as
      // a source here: dropping a vault whose accounts API reports a position
      // just because both its RPCs were unreachable reports "no holdings" to a
      // user who holds thousands of USDC.
      if (shares.totalRaw === 0n && !hasRedeemActivity && !r25h && emberPosition == null) return;

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
        const result = await navFor(entry, provider, deps);
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
        actionPeriod = resolveR25TrancheActionPeriod(r25Positions!.get(entry.r25VaultId!)!, totalShares, nav, entry.redeemability!.lockDays, entry.redeemability!.async, now);
      } else if (rawRedeem != null) {
        actionPeriod = resolveRedeemableActionPeriod(rawRedeem, Number(shares.totalHuman), nav, entry.redeemability!.lockDays, entry.redeemability!.async);
      } else if (entry.r25VaultId && r25Periods?.has(entry.r25VaultId)) {
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
      // failure was already recorded above and degrades to the on-chain path.
      if (emberPosition) {
        const position = computePAlphaPosition({ ...common, emberPosition });
        if (sharesUnknown) {
          // The value is Ember's, but the wallet balance is not known — say so
          // rather than reporting the 0 that failed reads sum to.
          position.shares = null;
          position.assumptions.sharesResolvedFrom = 'unavailable';
        }
        positions.push(position);
        return;
      }

      // R25 vaults with API data get real earnings (not estimated).
      if (r25h) {
        const posData = entry.r25VaultId ? r25Positions?.get(entry.r25VaultId) : undefined;
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

export async function runUpgrade(): Promise<Envelope<UpgradeResult>> {
  const errors: Envelope<unknown>['errors'] = [];
  try {
    const r = await selfUpdate({});
    return makeEnvelope(r, errors);
  } catch (e) {
    errors.push({ scope: 'upgrade', error: String((e as Error).message ?? e) });
    return makeEnvelope({ upgraded: false, from: '', to: '', files: [] }, errors);
  }
}

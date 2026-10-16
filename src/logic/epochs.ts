import type { ActionPeriod, Epoch, EpochTerms, EpochView, VaultRegistryEntry } from '../types.ts';
import { isoToSec } from '../util/time.ts';
import { buildActionPeriod } from './actionPeriod.ts';

export interface EpochError { scope: string; error: string }

/** Parsed epoch timestamps (seconds). */
interface EpochSecs {
  lockStart: number; lockEnd: number;
  actionStart: number; actionEnd: number;
  withdrawable: number;
  depositStart: number | null; depositEnd: number | null;
}

/** Parse + sanity-check one epoch; returns an error message instead when it is unusable. */
function parseEpoch(e: Epoch): EpochSecs | string {
  const named: Array<[string, string | undefined]> = [
    ['lockStart', e.lockStart], ['lockEnd', e.lockEnd],
    ['actionStart', e.actionStart], ['actionEnd', e.actionEnd],
    ['withdrawable', e.withdrawable],
    ...(e.deposit ? ([['deposit.start', e.deposit.start], ['deposit.end', e.deposit.end]] as Array<[string, string]>) : []),
    ...e.terms.map((t): [string, string] => ['terms.from', t.from]),
  ];
  for (const [name, iso] of named) {
    if (iso == null || isoToSec(iso) == null) return `unparseable ${name}: ${iso}`;
  }
  const s = (iso: string) => isoToSec(iso)!;
  const secs: EpochSecs = {
    lockStart: s(e.lockStart), lockEnd: s(e.lockEnd),
    actionStart: s(e.actionStart), actionEnd: s(e.actionEnd),
    withdrawable: s(e.withdrawable),
    depositStart: e.deposit ? s(e.deposit.start) : null,
    depositEnd: e.deposit ? s(e.deposit.end) : null,
  };
  if (secs.lockEnd <= secs.lockStart) return 'lockEnd must be after lockStart';
  if (secs.actionEnd <= secs.actionStart) return 'actionEnd must be after actionStart';
  if (secs.depositStart != null && secs.depositEnd! <= secs.depositStart) return 'deposit.end must be after deposit.start';
  return secs;
}

function toView(e: Epoch, secs: EpochSecs, role: EpochView['role'], now: number): EpochView {
  const terms: EpochTerms[] = [...e.terms].sort((a, b) => isoToSec(a.from)! - isoToSec(b.from)!);
  let currentTerms: EpochTerms | null = null;
  for (const t of terms) if (isoToSec(t.from)! <= now) currentTerms = t;
  if (currentTerms == null) currentTerms = terms[0] ?? null;

  const depositOpen = secs.depositStart != null && now >= secs.depositStart && now < secs.depositEnd!;
  const opensAt = secs.depositStart ?? secs.lockStart;
  const status: EpochView['status'] = now < opensAt ? 'upcoming' : depositOpen ? 'deposit-open' : 'locked';

  return {
    id: e.id,
    label: e.label,
    role,
    status,
    deposit: e.deposit ? { start: e.deposit.start, end: e.deposit.end, isOpen: depositOpen } : null,
    lockStart: e.lockStart,
    lockEnd: e.lockEnd,
    actionPeriod: buildActionPeriod(secs.actionStart, secs.actionEnd, secs.withdrawable, 'config', now),
    withdrawable: e.withdrawable,
    currentTerms,
    terms,
  };
}

/**
 * Resolve a vault's epochs at `now`: invalid epochs are skipped (and reported),
 * epochs past `withdrawable` drop out (unredeemed holdings roll over into the
 * next epoch), the rest are sorted by lockStart. The first is `current` — the
 * epoch existing holdings are in; later ones are `next`.
 */
export function resolveEpochs(entry: VaultRegistryEntry, now: number): { epochs: EpochView[]; errors: EpochError[] } {
  const errors: EpochError[] = [];
  const live: Array<{ e: Epoch; secs: EpochSecs }> = [];
  for (const e of entry.epochs ?? []) {
    const parsed = parseEpoch(e);
    if (typeof parsed === 'string') {
      errors.push({ scope: `epochs:${e.id}`, error: parsed });
      continue;
    }
    if (now < parsed.withdrawable) live.push({ e, secs: parsed });
  }
  live.sort((a, b) => a.secs.lockStart - b.secs.lockStart);
  return {
    epochs: live.map(({ e, secs }, i) => toView(e, secs, i === 0 ? 'current' : 'next', now)),
    errors,
  };
}

/** The epoch existing holdings are in, or null when no epoch is live. */
export function currentEpoch(entry: VaultRegistryEntry, now: number): EpochView | null {
  return resolveEpochs(entry, now).epochs[0] ?? null;
}

/** Registry APY at `now`: the current epoch's active net APY, else apyFallback. */
export function epochApy(entry: VaultRegistryEntry, now: number): number {
  return currentEpoch(entry, now)?.currentTerms?.netApy ?? entry.apyFallback;
}

/** Config action period of the current epoch; unavailable when no epoch is live. */
export function resolveActionPeriod(entry: VaultRegistryEntry, now: number): ActionPeriod {
  return currentEpoch(entry, now)?.actionPeriod ?? buildActionPeriod(null, null, null, 'unavailable', now);
}

/** R25 nextMaturityDate may differ from the configured `withdrawable` by hours. */
const R25_MATCH_TOLERANCE_SEC = 86400;

/**
 * Attach the R25 /vault/period window (APC3M) to the live epoch it describes:
 * the epoch whose `withdrawable` is within 1 day of R25 `nextMaturityDate`.
 * During a season overlap R25 already reports the NEXT season, so pinning it to
 * the current epoch would show S2's window against S1's holdings.
 *
 * Returns the epoch views (the matched one carries the R25 object; inputs are
 * not mutated) and the top-level action period — always the current epoch's,
 * so `epochs[0].actionPeriod === actionPeriod`. No live epoch → R25 when
 * available (nothing to match against, but better than nothing), else
 * unavailable.
 */
export function attachR25Period(
  views: EpochView[],
  r25: ActionPeriod | null,
  maturitySec: number | null,
  now: number,
): { epochs: EpochView[]; actionPeriod: ActionPeriod } {
  if (views.length === 0) {
    return { epochs: [], actionPeriod: r25 ?? buildActionPeriod(null, null, null, 'unavailable', now) };
  }
  let match = -1;
  if (r25 != null && maturitySec != null) {
    let best = Infinity;
    views.forEach((v, i) => {
      const diff = Math.abs(isoToSec(v.withdrawable)! - maturitySec);
      if (diff <= R25_MATCH_TOLERANCE_SEC && diff < best) { best = diff; match = i; }
    });
  }
  const epochs = match < 0 ? views : views.map((v, i) => (i === match ? { ...v, actionPeriod: r25! } : v));
  return { epochs, actionPeriod: epochs[0]!.actionPeriod };
}

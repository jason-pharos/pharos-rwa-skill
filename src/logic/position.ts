import type { ActionPeriod, Position, R25HoldingInfo, VaultRegistryEntry } from '../types.ts';
import { isoToSec, dayDiff } from '../util/time.ts';

const SECONDS_PER_YEAR = 31557600; // 365.25d

/**
 * Lock-window timing shared by every vault: how long the position has been
 * deposited, and the lock length in years used to project total yield.
 */
export function lockTiming(entry: VaultRegistryEntry, now: number): {
  depositedDurationDays: number | null;
  lockYears: number | null;
  /** Years left until lock end (0 once the lock has ended). */
  remainingLockYears: number | null;
} {
  const lockStartSec = isoToSec(entry.actionPeriodConfig?.lockStart ?? '');
  const lockEndSec = isoToSec(entry.actionPeriodConfig?.lockEnd ?? '');
  return {
    depositedDurationDays: lockStartSec != null && now >= lockStartSec ? dayDiff(lockStartSec, now) : null,
    lockYears: lockStartSec != null && lockEndSec != null ? (lockEndSec - lockStartSec) / SECONDS_PER_YEAR : null,
    remainingLockYears: lockEndSec != null ? Math.max(0, lockEndSec - now) / SECONDS_PER_YEAR : null,
  };
}

export function computePosition(args: {
  entry: VaultRegistryEntry;
  sharesHuman: string;
  nav: number | null;
  apy: number | null;
  actionPeriod: ActionPeriod;
  now: number;
  navResolvedFrom?: string;
  /** Real earnings from the R25 holdings API. When present, replaces the
   *  entryNavBaseline estimate with actual yield data. */
  r25Holding?: R25HoldingInfo;
}): Position {
  const { entry, sharesHuman, nav, apy, actionPeriod, now, navResolvedFrom, r25Holding } = args;
  const shares = Number(sharesHuman);
  const currentValue = nav != null ? shares * nav : null;

  // When R25 data is available, use actual earnings; principal is derived
  // (currentValue − realEarnings) instead of estimated (shares × entryNavBaseline).
  const hasRealEarnings = r25Holding != null && currentValue != null;
  const realizedYield = hasRealEarnings ? r25Holding.earnings : (currentValue != null ? currentValue - shares * entry.entryNavBaseline : null);
  const principal = hasRealEarnings ? currentValue - r25Holding.earnings : shares * entry.entryNavBaseline;

  const { depositedDurationDays, remainingLockYears } = lockTiming(entry, now);

  // Forward-looking: yield already earned plus APY applied to the time left in
  // the lock. `principal × apy × lockYears` (one full epoch) understates the
  // total whenever the holder rolled over from an earlier epoch — the on-chain
  // NAV keeps compounding across epochs while entryNavBaseline stays at the
  // epoch-entry price, so earned yield can already exceed one epoch's worth.
  // With no NAV we cannot know what has been earned; project off principal.
  const effectiveApy = apy ?? entry.apyFallback;
  const projectionBase = currentValue ?? principal;
  const expectedTotalYield = remainingLockYears != null
    ? (realizedYield ?? 0) + projectionBase * effectiveApy * remainingLockYears
    : null;

  const assumptions: Record<string, string | number> = {
    navResolvedFrom: navResolvedFrom ?? 'onchain',
    // expectedTotalYield is cumulative-to-lock-end, not per-epoch.
    expectedYieldBasis: 'earned-to-date + apy x time-to-lock-end',
  };
  if (hasRealEarnings) {
    assumptions.valueResolvedFrom = 'r25-api';
  } else {
    assumptions.entryNav = entry.entryNavBaseline;
  }

  const position: Position = {
    vault: entry.id,
    shares: sharesHuman,
    nav,
    currentValue,
    estimated: !hasRealEarnings,
    assumptions,
    principal,
    realizedYield,
    depositedDurationDays,
    lockEnd: entry.actionPeriodConfig?.lockEnd ?? null,
    expectedTotalYield,
    actionPeriod,
  };
  if (r25Holding) position.r25 = r25Holding;
  return position;
}

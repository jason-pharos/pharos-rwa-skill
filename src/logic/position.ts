import type { ActionPeriod, Position, VaultRegistryEntry } from '../types.ts';
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
  const lockStartSec = isoToSec(entry.actionPeriodConfig.lockStart);
  const lockEndSec = isoToSec(entry.actionPeriodConfig.lockEnd);
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
}): Position {
  const { entry, sharesHuman, nav, apy, actionPeriod, now, navResolvedFrom } = args;
  const shares = Number(sharesHuman);
  const currentValue = nav != null ? shares * nav : null;
  const principal = shares * entry.entryNavBaseline;
  const realizedYield = currentValue != null ? currentValue - principal : null;

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

  return {
    vault: entry.id,
    shares: sharesHuman,
    nav,
    currentValue,
    estimated: true,
    assumptions: {
      entryNav: entry.entryNavBaseline,
      navResolvedFrom: navResolvedFrom ?? 'onchain',
      // expectedTotalYield is cumulative-to-lock-end, not per-epoch.
      expectedYieldBasis: 'earned-to-date + apy x time-to-lock-end',
    },
    principal,
    realizedYield,
    depositedDurationDays,
    lockEnd: entry.actionPeriodConfig.lockEnd,
    expectedTotalYield,
    actionPeriod,
  };
}

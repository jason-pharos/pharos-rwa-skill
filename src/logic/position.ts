import type { ActionPeriod, Position, VaultRegistryEntry } from '../types.ts';
import { isoToSec, dayDiff } from '../util/time.ts';

const SECONDS_PER_YEAR = 31557600; // 365.25d

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

  const lockStartSec = isoToSec(entry.actionPeriodConfig.lockStart);
  const lockEndSec = isoToSec(entry.actionPeriodConfig.lockEnd);
  const depositedDurationDays = lockStartSec != null && now >= lockStartSec ? dayDiff(lockStartSec, now) : null;

  const effectiveApy = apy ?? entry.apyFallback;
  const lockYears = lockStartSec != null && lockEndSec != null ? (lockEndSec - lockStartSec) / SECONDS_PER_YEAR : null;
  const expectedTotalYield = lockYears != null ? principal * effectiveApy * lockYears : null;

  return {
    vault: entry.id,
    shares: sharesHuman,
    nav,
    currentValue,
    estimated: true,
    assumptions: {
      entryNav: entry.entryNavBaseline,
      navSource: entry.navSource,
      navResolvedFrom: navResolvedFrom ?? entry.navSource,
    },
    principal,
    realizedYield,
    depositedDurationDays,
    lockEnd: entry.actionPeriodConfig.lockEnd,
    expectedTotalYield,
    actionPeriod,
  };
}

import type { ActionPeriod, Position, VaultRegistryEntry } from '../types.ts';
import type { PositionValue } from '../sources/ember.ts';
import { lockTiming } from './position.ts';

/** API money fields are integer strings scaled by 1e9 ("USD e9"). */
function usdE9(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === '') return null; // Number('') is 0, not NaN
  const n = Number(raw);
  return Number.isFinite(n) ? n / 1e9 : null;
}

/**
 * pALPHA-only position math, driven by the Ember accounts API instead of
 * shares × NAV.
 *
 * Why a separate function: the Ember API is the vault's own book of record for
 * pALPHA. It reports the position value and the yield split (realized vs
 * unrealized) across every chain the receipt token lives on, so we do not have
 * to approximate principal from a single `entryNavBaseline`. The generic
 * `computePosition` stays the path for every other vault — this API only
 * covers pALPHA.
 *
 * Mapping:
 *  - currentValue    = positionValueUsdE9 / 1e9
 *  - realizedYield   = totalYieldUsdE9 / 1e9  (yield earned so far; the
 *                      realized/unrealized split is kept in `yieldBreakdown`)
 *  - principal       = currentValue − totalYield  (actual cost basis, not an
 *                      entryNav approximation)
 *  - expectedTotalYield = totalYield + currentValue × apy × yearsLeftInLock
 *                      (forward-looking). The API's yield is cumulative since
 *                      the holder deposited, which can be several epochs back,
 *                      so the generic `principal × apy × lockYears` (one epoch)
 *                      could come out BELOW the yield already earned. Projecting
 *                      from today to lock end keeps the two comparable.
 *
 * `shares` and `nav` stay as passed in (on-chain), so the position still shows
 * what the wallet actually holds.
 */
export function computePAlphaPosition(args: {
  entry: VaultRegistryEntry;
  sharesHuman: string;
  nav: number | null;
  apy: number | null;
  actionPeriod: ActionPeriod;
  now: number;
  emberPosition: PositionValue;
  navResolvedFrom?: string;
}): Position {
  const { entry, sharesHuman, nav, apy, actionPeriod, now, emberPosition, navResolvedFrom } = args;

  const currentValue = usdE9(emberPosition.positionValueUsdE9);
  const totalYield = usdE9(emberPosition.totalYieldUsdE9);
  const realized = usdE9(emberPosition.realizedYieldUsdE9);
  const unrealized = usdE9(emberPosition.unrealizedYieldUsdE9);
  const principal = currentValue != null && totalYield != null ? currentValue - totalYield : null;

  const { depositedDurationDays, remainingLockYears } = lockTiming(entry, now);
  const effectiveApy = apy ?? entry.apyFallback;
  const expectedTotalYield = totalYield != null && currentValue != null && remainingLockYears != null
    ? totalYield + currentValue * effectiveApy * remainingLockYears
    : null;

  const position: Position = {
    vault: entry.id,
    shares: sharesHuman,
    nav,
    currentValue,
    estimated: true,
    assumptions: {
      valueResolvedFrom: 'ember-api',
      navResolvedFrom: navResolvedFrom ?? 'onchain',
      // expectedTotalYield is cumulative-to-lock-end, not per-epoch.
      expectedYieldBasis: 'earned-to-date + apy x time-to-lock-end',
      // OUT_OF_SYNC means the API's indexer is behind the chain; the numbers
      // are still the best available but may lag a block range.
      emberStatus: emberPosition.status,
    },
    principal,
    realizedYield: totalYield,
    depositedDurationDays,
    lockEnd: entry.actionPeriodConfig?.lockEnd ?? null,
    expectedTotalYield,
    actionPeriod,
  };

  if (realized != null && unrealized != null && totalYield != null) {
    position.yieldBreakdown = { realized, unrealized, total: totalYield };
  }
  return position;
}

import type { ActionPeriod, VaultRegistryEntry } from '../types.ts';
import { isoToSec, secToIso, windowState } from '../util/time.ts';

function build(startTs: number | null, endTs: number | null, withdrawableTs: number | null, source: ActionPeriod['source'], now: number): ActionPeriod {
  if (startTs === null || endTs === null) {
    return { start: null, end: null, startTs: null, endTs: null, withdrawableDate: null, source: 'unavailable', isOpen: false, opensInDays: null, closesInDays: null, stale: false };
  }
  const st = windowState(startTs, endTs, now);
  return {
    start: secToIso(startTs),
    end: secToIso(endTs),
    startTs, endTs,
    withdrawableDate: withdrawableTs !== null ? secToIso(withdrawableTs).slice(0, 10) : null,
    source,
    isOpen: st.isOpen,
    opensInDays: st.opensInDays,
    closesInDays: st.closesInDays,
    stale: st.stale,
  };
}

/**
 * Action period (the withdraw window) comes from the per-epoch configured
 * dates for BOTH vaults. The pALPHA vault-info API's `phases` are APY accrual
 * periods, NOT withdraw windows, and are not kept up to date — so they must
 * NOT drive the action period. These config dates are maintained per epoch
 * (see config/vaults.json / the registry).
 */
export function resolveActionPeriod(entry: VaultRegistryEntry, now: number): ActionPeriod {
  const cfg = entry.actionPeriodConfig;
  const startTs = isoToSec(cfg.actionStart);
  const endTs = isoToSec(cfg.actionEnd);
  const wTs = isoToSec(cfg.withdrawable);
  if (startTs !== null && endTs !== null) return build(startTs, endTs, wTs, 'config', now);
  return build(null, null, null, 'unavailable', now);
}

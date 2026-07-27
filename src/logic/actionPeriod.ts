import type { ActionPeriod, VaultRegistryEntry } from '../types.ts';
import type { VaultInfo } from '../sources/vaultInfo.ts';
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

function pickPhase(phases: VaultInfo['phases'], now: number): { startTs: number; endTs: number } | null {
  if (phases.length === 0) return null;
  const containing = phases.find((p) => now >= p.startTs && now <= p.endTs);
  if (containing) return containing;
  return [...phases].sort((a, b) => b.endTs - a.endTs)[0] ?? null;
}

export function resolveActionPeriod(entry: VaultRegistryEntry, apiInfo: VaultInfo | null, now: number): ActionPeriod {
  if (entry.navSource === 'api' && apiInfo) {
    const phase = pickPhase(apiInfo.phases, now);
    if (phase) return build(phase.startTs, phase.endTs, apiInfo.withdrawableTs, 'api', now);
  }
  const cfg = entry.actionPeriodConfig;
  const startTs = isoToSec(cfg.actionStart);
  const endTs = isoToSec(cfg.actionEnd);
  const wTs = isoToSec(cfg.withdrawable);
  if (startTs !== null && endTs !== null) return build(startTs, endTs, wTs, 'config', now);
  return build(null, null, null, 'unavailable', now);
}

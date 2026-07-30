import type { Position, R25Tranche, VaultId } from '../types.ts';

export type Urgency =
  | 'open' | 'opening-soon' | 'closing-soon' | 'future' | 'closed' | 'unknown'
  // redeemability-based (VRPC-SemiYearly):
  | 'claimable' | 'redeemable' | 'pending' | 'locked';

export interface Reminder {
  vault: VaultId;
  urgency: Urgency;
  message: string;
  actionPeriod: Position['actionPeriod'];
}

function classify(ap: Position['actionPeriod']): Urgency {
  // Redeemability-based vaults (no fixed dates): urgency from live amounts,
  // most-actionable first: claimable (settled) > redeemable (can request now)
  // > pending (already requested, awaiting settlement) > locked.
  if (ap.source === 'onchain-redeemable') {
    const r = ap.redeemable;
    if (r && r.claimableRedeemShares > 0) return 'claimable';
    if (r && r.maxRedeemShares > 0) return 'redeemable';
    if (r && r.pendingRedeemShares > 0) return 'pending';
    return 'locked';
  }
  if (ap.source === 'unavailable') return 'unknown';
  if (ap.stale) return 'closed';
  if (ap.isOpen) return ap.closesInDays != null && ap.closesInDays <= 7 ? 'closing-soon' : 'open';
  if (ap.opensInDays != null) return ap.opensInDays <= 7 ? 'opening-soon' : 'future';
  return 'unknown';
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Describe tranche expiry for redeemability-based vaults. */
function trancheNote(tranches: R25Tranche[] | undefined): string {
  if (!tranches || tranches.length === 0) return '';
  const next = tranches[0]!; // sorted by expirationTs ascending
  if (tranches.length === 1) {
    return ` Tranche of ${fmt(next.shares)} share(s) expires ${next.expirationDate} (${next.daysUntilExpiration}d).`;
  }
  const totalShares = tranches.reduce((s, t) => s + t.shares, 0);
  return ` ${tranches.length} tranches totalling ${fmt(totalShares)} share(s); nearest expires ${next.expirationDate} (${next.daysUntilExpiration}d), latest ${tranches[tranches.length - 1]!.expirationDate}.`;
}

function messageFor(vault: VaultId, u: Urgency, ap: Position['actionPeriod'], tranches?: R25Tranche[]): string {
  const r = ap.redeemable;
  const tn = trancheNote(tranches);
  switch (u) {
    case 'closing-soon': return `${vault}: withdraw window closes in ${ap.closesInDays} day(s).`;
    case 'open': return `${vault}: withdraw window is open now.`;
    case 'opening-soon': return `${vault}: withdraw window opens in ${ap.opensInDays} day(s).`;
    case 'future': return `${vault}: withdraw window opens in ${ap.opensInDays} day(s).`;
    case 'closed': return `${vault}: last known withdraw window has passed; config may be stale.`;
    case 'claimable': return `${vault}: ${fmt(r?.claimableRedeemShares ?? 0)} share(s) have settled and can be claimed now.${tn}`;
    case 'redeemable': return `${vault}: ${fmt(r?.maxRedeemShares ?? 0)} share(s) are redeemable now; the rest is still locked (${r?.lockDays ?? '?'}-day term).${tn}`;
    case 'pending': return `${vault}: a withdraw request for ${fmt(r?.pendingRedeemShares ?? 0)} share(s) is submitted and awaiting settlement.${tn}`;
    case 'locked': return `${vault}: nothing redeemable right now (locked). Funds unlock ~${r?.lockDays ?? '?'} days after deposit${r?.async ? '; submit a withdraw request ahead of maturity' : ''}.${tn}`;
    default: return `${vault}: action period unavailable.`;
  }
}

export function buildReminders(positions: Position[]): Reminder[] {
  return positions.map((p) => {
    const urgency = classify(p.actionPeriod);
    return { vault: p.vault, urgency, message: messageFor(p.vault, urgency, p.actionPeriod, p.r25?.tranches), actionPeriod: p.actionPeriod };
  });
}

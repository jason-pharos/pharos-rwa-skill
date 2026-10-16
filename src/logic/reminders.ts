import type { EpochView, Position, R25Tranche, VaultId } from '../types.ts';

export type Urgency =
  | 'open' | 'opening-soon' | 'closing-soon' | 'future' | 'closed' | 'unknown'
  // redeemability-based (VRPC-SemiYearly):
  | 'claimable' | 'redeemable' | 'pending' | 'locked';

export interface Reminder {
  vault: VaultId;
  /** Epoch id (APC3M / pALPHA); absent for non-epoch vaults. */
  epoch?: string;
  urgency: Urgency;
  message: string;
  actionPeriod: Position['actionPeriod'];
}

function classify(ap: Position['actionPeriod']): Urgency {
  // Redeemability-based vaults (no fixed dates): urgency from live amounts,
  // most-actionable first: claimable (settled) > redeemable (can request now)
  // > pending (already requested, awaiting settlement) > locked.
  // Covers both 'onchain-redeemable' and 'r25-api' with tranche data.
  if (ap.redeemable) {
    const r = ap.redeemable;
    if (r.claimableRedeemShares > 0) return 'claimable';
    if (r.maxRedeemShares > 0) return 'redeemable';
    if (r.pendingRedeemShares > 0) return 'pending';
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

function messageFor(vault: string, u: Urgency, ap: Position['actionPeriod'], tranches?: R25Tranche[]): string {
  const r = ap.redeemable;
  const tn = trancheNote(tranches);
  const isR25 = ap.source === 'r25-api';
  switch (u) {
    case 'closing-soon': return `${vault}: withdraw window closes in ${ap.closesInDays} day(s).`;
    case 'open': return `${vault}: withdraw window is open now.`;
    case 'opening-soon': return `${vault}: withdraw window opens in ${ap.opensInDays} day(s).`;
    case 'future': return `${vault}: withdraw window opens in ${ap.opensInDays} day(s).`;
    case 'closed': return `${vault}: last known withdraw window has passed; config may be stale.`;
    case 'claimable': return `${vault}: ${fmt(r?.claimableRedeemShares ?? 0)} share(s) have settled and can be claimed now.${tn}`;
    case 'redeemable':
      if (isR25) return `${vault}: ${fmt(r?.maxRedeemShares ?? 0)} share(s) are requestable for withdrawal now (all non-expired tranche shares).${tn}`;
      return `${vault}: ${fmt(r?.maxRedeemShares ?? 0)} share(s) are redeemable now; the rest is still locked (${r?.lockDays ?? '?'}-day term).${tn}`;
    case 'pending': return `${vault}: a withdraw request for ${fmt(r?.pendingRedeemShares ?? 0)} share(s) is submitted and awaiting settlement.${tn}`;
    case 'locked':
      if (isR25) return `${vault}: no non-expired shares available for withdrawal.${tn}`;
      return `${vault}: nothing redeemable right now (locked). Funds unlock ~${r?.lockDays ?? '?'} days after deposit${r?.async ? '; submit a withdraw request ahead of maturity' : ''}.${tn}`;
    default: return `${vault}: action period unavailable.`;
  }
}

function pct(n: number): string {
  return `${Number((n * 100).toFixed(2))}%`;
}

/** "Oct 27, 09:00 UTC+8" */
function fmtUtc8(iso: string): string {
  const s = new Date(Date.parse(iso)).toLocaleString('en-US', {
    timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return `${s} UTC+8`;
}

/**
 * One reminder per live epoch, each from that epoch's own action period (the
 * R25 window is already attached to the epoch it belongs to; see
 * attachR25Period). No live epoch: the position's action period when it has
 * one (e.g. R25 answered), else an unknown reminder.
 */
function epochReminders(p: Position, epochs: EpochView[]): Reminder[] {
  if (epochs.length === 0) {
    if (p.actionPeriod.source !== 'unavailable') return [singleReminder(p)];
    return [{ vault: p.vault, urgency: 'unknown', message: `${p.vault}: no active epoch configured; config may be stale.`, actionPeriod: p.actionPeriod }];
  }
  return epochs.map((e) => {
    const ap = e.actionPeriod;
    const urgency = classify(ap);
    const who = `${p.vault} ${e.label}`;
    let message = urgency === 'closed'
      ? `${who}: withdraw window for this epoch has closed; holdings roll over into the next epoch after ${fmtUtc8(e.withdrawable)}.`
      : messageFor(who, urgency, ap, p.r25?.tranches);
    if (e.deposit?.isOpen && e.currentTerms) {
      message += ` Deposit open until ${fmtUtc8(e.deposit.end)} (${e.currentTerms.label} net APY ${pct(e.currentTerms.netApy)}).`;
    }
    return { vault: p.vault, epoch: e.id, urgency, message, actionPeriod: ap };
  });
}

function singleReminder(p: Position): Reminder {
  const urgency = classify(p.actionPeriod);
  return { vault: p.vault, urgency, message: messageFor(p.vault, urgency, p.actionPeriod, p.r25?.tranches), actionPeriod: p.actionPeriod };
}

export function buildReminders(positions: Position[]): Reminder[] {
  return positions.flatMap((p) => {
    if (p.epochs) return epochReminders(p, p.epochs);
    return [singleReminder(p)];
  });
}

import type { Position, VaultId } from '../types.ts';

export type Urgency = 'open' | 'opening-soon' | 'closing-soon' | 'future' | 'closed' | 'unknown';

export interface Reminder {
  vault: VaultId;
  urgency: Urgency;
  message: string;
  actionPeriod: Position['actionPeriod'];
}

function classify(ap: Position['actionPeriod']): Urgency {
  if (ap.source === 'unavailable') return 'unknown';
  if (ap.stale) return 'closed';
  if (ap.isOpen) return ap.closesInDays != null && ap.closesInDays <= 7 ? 'closing-soon' : 'open';
  if (ap.opensInDays != null) return ap.opensInDays <= 7 ? 'opening-soon' : 'future';
  return 'unknown';
}

function messageFor(vault: VaultId, u: Urgency, ap: Position['actionPeriod']): string {
  switch (u) {
    case 'closing-soon': return `${vault}: withdraw window closes in ${ap.closesInDays} day(s).`;
    case 'open': return `${vault}: withdraw window is open now.`;
    case 'opening-soon': return `${vault}: withdraw window opens in ${ap.opensInDays} day(s).`;
    case 'future': return `${vault}: withdraw window opens in ${ap.opensInDays} day(s).`;
    case 'closed': return `${vault}: last known withdraw window has passed; config may be stale.`;
    default: return `${vault}: action period unavailable.`;
  }
}

export function buildReminders(positions: Position[]): Reminder[] {
  return positions.map((p) => {
    const urgency = classify(p.actionPeriod);
    return { vault: p.vault, urgency, message: messageFor(p.vault, urgency, p.actionPeriod), actionPeriod: p.actionPeriod };
  });
}

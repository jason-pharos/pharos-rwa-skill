export function nowSec(): number { return Math.floor(Date.now() / 1000); }

export function isoToSec(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function secToIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

export function dayDiff(fromSec: number, toSec: number): number {
  return Math.round((toSec - fromSec) / 86400);
}

export function windowState(startSec: number, endSec: number, now: number): {
  isOpen: boolean; opensInDays: number | null; closesInDays: number | null; stale: boolean;
} {
  if (now < startSec) return { isOpen: false, opensInDays: dayDiff(now, startSec), closesInDays: null, stale: false };
  if (now <= endSec) return { isOpen: true, opensInDays: null, closesInDays: dayDiff(now, endSec), stale: false };
  return { isOpen: false, opensInDays: null, closesInDays: null, stale: true };
}

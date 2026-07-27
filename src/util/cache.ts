import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export function cacheDir(): string {
  const base = process.env.PHAROS_RWA_CACHE_DIR
    || join(homedir() || tmpdir(), '.cache', 'pharos-rwa');
  try { mkdirSync(base, { recursive: true }); } catch { /* ignore */ }
  return base;
}

interface Wrapped { savedAt: number; value: unknown; }

export function writeCache(name: string, value: unknown): void {
  const w: Wrapped = { savedAt: Math.floor(Date.now() / 1000), value };
  try { writeFileSync(join(cacheDir(), `${name}.json`), JSON.stringify(w)); } catch { /* ignore */ }
}

export function readCache<T>(name: string, ttlSec: number): T | null {
  try {
    const raw = readFileSync(join(cacheDir(), `${name}.json`), 'utf8');
    const w = JSON.parse(raw) as Wrapped;
    if (Math.floor(Date.now() / 1000) - w.savedAt > ttlSec) return null;
    return w.value as T;
  } catch { return null; }
}

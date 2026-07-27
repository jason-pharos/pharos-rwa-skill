import type { UpdateInfo } from '../types.ts';
import { fetchJson } from '../util/http.ts';
import { readCache, writeCache } from '../util/cache.ts';
import { VERSION, OWNER, REPO } from '../version.ts';

const CACHE_KEY = 'version-check';
const TTL_SEC = 24 * 3600;

function parts(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
}

export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

interface CachedTag { tag: string; }

export async function checkForUpdate(opts: { noRemote: boolean }): Promise<UpdateInfo | undefined> {
  if (opts.noRemote || process.env.PHAROS_RWA_NO_REMOTE) return undefined;
  let tag: string | null = null;
  const cached = readCache<CachedTag>(CACHE_KEY, TTL_SEC);
  if (cached) tag = cached.tag;
  else {
    try {
      const resp = await fetchJson<{ tag_name?: string }>(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`);
      tag = resp.tag_name ?? null;
      if (tag) writeCache(CACHE_KEY, { tag });
    } catch { return undefined; }
  }
  if (!tag) return undefined;
  return isNewer(tag, VERSION) ? { current: VERSION, latest: tag } : undefined;
}

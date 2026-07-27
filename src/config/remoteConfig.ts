import type { VaultRegistryEntry } from '../types.ts';
import { DEFAULT_REGISTRY } from './registry.ts';
import { fetchJson } from '../util/http.ts';
import { readCache, writeCache } from '../util/cache.ts';
import { OWNER, REPO } from '../version.ts';

const CACHE_KEY = 'remote-config';
const TTL_SEC = 6 * 3600;

interface RemoteOverride {
  version: number;
  vaults: Array<Partial<VaultRegistryEntry> & { id: string }>;
}

export function mergeRegistry(base: VaultRegistryEntry[], override: unknown): VaultRegistryEntry[] {
  const o = override as RemoteOverride | null;
  if (!o || !Array.isArray(o.vaults)) return base;
  return base.map((entry) => {
    const patch = o.vaults.find((v) => v && v.id === entry.id);
    if (!patch) return entry;
    // Only allow specific fields to be overridden from remote config.
    // Identity/address fields (id, displayName, chainId, shareToken, balanceSources, onchainNav, vaultInfoApiId)
    // are always taken from the base and protected from override.
    return {
      ...entry,
      apyFallback: patch.apyFallback ?? entry.apyFallback,
      entryNavBaseline: patch.entryNavBaseline ?? entry.entryNavBaseline,
      actionPeriodConfig: { ...entry.actionPeriodConfig, ...(patch.actionPeriodConfig ?? {}) },
    };
  });
}

function configUrl(): string {
  return process.env.PHAROS_RWA_CONFIG_URL
    || `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/config/vaults.json`;
}

export async function loadRegistry(opts: { noRemote: boolean }): Promise<VaultRegistryEntry[]> {
  if (opts.noRemote || process.env.PHAROS_RWA_NO_REMOTE) return DEFAULT_REGISTRY;
  const cached = readCache<RemoteOverride>(CACHE_KEY, TTL_SEC);
  if (cached) return mergeRegistry(DEFAULT_REGISTRY, cached);
  try {
    const remote = await fetchJson<RemoteOverride>(configUrl());
    writeCache(CACHE_KEY, remote);
    return mergeRegistry(DEFAULT_REGISTRY, remote);
  } catch {
    return DEFAULT_REGISTRY;
  }
}

import type { AdviceBundle, Envelope, Position, UpdateInfo, VaultMarket, VaultRegistryEntry } from './types.ts';
import { loadRegistry } from './config/remoteConfig.ts';
import { fetchHarbor } from './sources/harbor.ts';
import { fetchVaultInfo, type VaultInfo } from './sources/vaultInfo.ts';
import { DEFAULT_RPC, DEFAULT_CHAIN_ID, makeProvider, getVaultShares, getErc20Decimals, getVaultNavOnchain } from './sources/chain.ts';
import { resolveActionPeriod } from './logic/actionPeriod.ts';
import { computePosition } from './logic/position.ts';
import { buildReminders, type Reminder } from './logic/reminders.ts';
import { buildAdvice } from './logic/advise.ts';
import { checkForUpdate } from './update/checkVersion.ts';
import { selfUpdate } from './update/selfUpdate.ts';
import { nowSec } from './util/time.ts';

export interface RunOpts { rpc?: string; noRemote: boolean; now?: number }

export function makeEnvelope<T>(data: T, errors: Envelope<T>['errors'], updateAvailable?: UpdateInfo): Envelope<T> {
  const env: Envelope<T> = { ok: errors.length === 0, generatedAt: new Date().toISOString(), data, errors };
  if (updateAvailable) env.updateAvailable = updateAvailable;
  return env;
}

async function safeUpdate(opts: RunOpts): Promise<UpdateInfo | undefined> {
  try { return await checkForUpdate({ noRemote: opts.noRemote }); } catch { return undefined; }
}

function providerFor(opts: RunOpts) {
  return makeProvider(opts.rpc ?? process.env.PHAROS_RPC_URL ?? DEFAULT_RPC, DEFAULT_CHAIN_ID);
}

export async function runVaults(opts: RunOpts): Promise<Envelope<{ vaults: VaultMarket[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  let vaults: VaultMarket[] = [];
  try { vaults = await fetchHarbor(); } catch (e) { errors.push({ scope: 'harbor', error: String((e as Error).message ?? e) }); }
  return makeEnvelope({ vaults }, errors, await safeUpdate(opts));
}

type NavResult = { nav: number | null; apy: number | null; apiInfo: VaultInfo | null; navResolvedFrom: 'api' | 'onchain' | 'onchain-fallback' | 'none' };

async function navFor(entry: VaultRegistryEntry, provider: ReturnType<typeof makeProvider>, shareDecimals: number): Promise<NavResult> {
  if (entry.navSource === 'api' && entry.vaultId) {
    let apiInfo: VaultInfo | null = null;
    try {
      apiInfo = await fetchVaultInfo(entry.vaultId);
    } catch {
      apiInfo = null; // API failed entirely — try on-chain fallback below
    }
    if (apiInfo && apiInfo.nav != null) {
      return { nav: apiInfo.nav, apy: apiInfo.apy, apiInfo, navResolvedFrom: 'api' };
    }
    // API unavailable or returned no price → on-chain ERC4626 convertToAssets fallback.
    if (entry.navOnchainFallback) {
      const fb = entry.navOnchainFallback;
      try {
        const nav = await getVaultNavOnchain(fb.vault, fb.shareDecimals, fb.assetDecimals, provider);
        return { nav, apy: apiInfo?.apy ?? entry.apyFallback, apiInfo, navResolvedFrom: 'onchain-fallback' };
      } catch {
        // fall through to null
      }
    }
    return { nav: apiInfo?.nav ?? null, apy: apiInfo?.apy ?? entry.apyFallback, apiInfo, navResolvedFrom: 'none' };
  }
  if (entry.navSource === 'onchain' && entry.coreVault && entry.usdc) {
    const usdcDecimals = await getErc20Decimals(entry.usdc, provider);
    const nav = await getVaultNavOnchain(entry.coreVault, shareDecimals, usdcDecimals, provider);
    return { nav, apy: entry.apyFallback, apiInfo: null, navResolvedFrom: 'onchain' };
  }
  return { nav: null, apy: entry.apyFallback, apiInfo: null, navResolvedFrom: 'none' };
}

async function buildPositions(address: string, opts: RunOpts, errors: Envelope<unknown>['errors']): Promise<Position[]> {
  const registry = await loadRegistry({ noRemote: opts.noRemote });
  const provider = providerFor(opts);
  const now = opts.now ?? nowSec();
  const positions: Position[] = [];

  await Promise.allSettled(registry.map(async (entry) => {
    try {
      // Sum share/receipt-token balance across ALL of the vault's chains
      // (pALPHA = Pharos + Ethereum; APC3M = Pharos only). The --rpc/opts.rpc
      // override applies to the Pharos chain (its documented meaning).
      const rpcOverrides = opts.rpc ? { [DEFAULT_CHAIN_ID]: opts.rpc } : {};
      const shares = await getVaultShares(entry.balanceSources, address, rpcOverrides);
      // Surface per-chain balance-read failures without dropping the position.
      for (const be of shares.errors) {
        errors.push({ scope: `${entry.id}:chain-${be.chainId}`, error: be.error });
      }
      if (shares.totalRaw === 0n) return; // no position on any chain
      const { nav, apy, apiInfo, navResolvedFrom } = await navFor(entry, provider, shares.decimals);
      const actionPeriod = resolveActionPeriod(entry, apiInfo, now);
      positions.push(computePosition({ entry, sharesHuman: shares.totalHuman, nav, apy, actionPeriod, now, navResolvedFrom }));
    } catch (e) {
      errors.push({ scope: entry.id, error: String((e as Error).message ?? e) });
    }
  }));

  return positions.sort((a, b) => a.vault.localeCompare(b.vault));
}

export async function runPosition(address: string, opts: RunOpts): Promise<Envelope<{ address: string; positions: Position[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope({ address, positions }, errors, await safeUpdate(opts));
}

export async function runReminders(address: string, opts: RunOpts): Promise<Envelope<{ address: string; reminders: Reminder[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope({ address, reminders: buildReminders(positions) }, errors, await safeUpdate(opts));
}

export async function runAdvise(address: string, opts: RunOpts): Promise<Envelope<AdviceBundle>> {
  const errors: Envelope<unknown>['errors'] = [];
  let market: VaultMarket[] = [];
  try { market = await fetchHarbor(); } catch (e) { errors.push({ scope: 'harbor', error: String((e as Error).message ?? e) }); }
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope(buildAdvice(market, positions), errors, await safeUpdate(opts));
}

export async function runUpgrade(): Promise<Envelope<{ upgraded: boolean; from: string; to: string; note?: string }>> {
  const errors: Envelope<unknown>['errors'] = [];
  try {
    const r = await selfUpdate({});
    return makeEnvelope(r, errors);
  } catch (e) {
    errors.push({ scope: 'upgrade', error: String((e as Error).message ?? e) });
    return makeEnvelope({ upgraded: false, from: '', to: '' }, errors);
  }
}

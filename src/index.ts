import type { AdviceBundle, Envelope, Position, UpdateInfo, VaultMarket, VaultRegistryEntry } from './types.ts';
import { loadRegistry } from './config/remoteConfig.ts';
import { fetchHarbor } from './sources/harbor.ts';
import { fetchVaultInfo, type VaultInfo } from './sources/vaultInfo.ts';
import { DEFAULT_RPC, DEFAULT_CHAIN_ID, makeProvider, getShareBalanceHuman, getErc20Decimals, getVaultNavOnchain } from './sources/chain.ts';
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

async function navFor(entry: VaultRegistryEntry, provider: ReturnType<typeof makeProvider>, shareDecimals: number): Promise<{ nav: number | null; apy: number | null; apiInfo: VaultInfo | null }> {
  if (entry.navSource === 'api' && entry.vaultId) {
    const info = await fetchVaultInfo(entry.vaultId);
    return { nav: info.nav, apy: info.apy, apiInfo: info };
  }
  if (entry.navSource === 'onchain' && entry.coreVault && entry.usdc) {
    const usdcDecimals = await getErc20Decimals(entry.usdc, provider);
    const nav = await getVaultNavOnchain(entry.coreVault, shareDecimals, usdcDecimals, provider);
    return { nav, apy: entry.apyFallback, apiInfo: null };
  }
  return { nav: null, apy: entry.apyFallback, apiInfo: null };
}

async function buildPositions(address: string, opts: RunOpts, errors: Envelope<unknown>['errors']): Promise<Position[]> {
  const registry = await loadRegistry({ noRemote: opts.noRemote });
  const provider = providerFor(opts);
  const now = opts.now ?? nowSec();
  const positions: Position[] = [];

  await Promise.allSettled(registry.map(async (entry) => {
    try {
      const bal = await getShareBalanceHuman(entry.shareToken, address, provider);
      if (bal.raw === 0n) return; // no position
      const { nav, apy, apiInfo } = await navFor(entry, provider, bal.decimals);
      const actionPeriod = resolveActionPeriod(entry, apiInfo, now);
      positions.push(computePosition({ entry, sharesHuman: bal.human, nav, apy, actionPeriod, now }));
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

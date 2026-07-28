import type { AdviceBundle, Envelope, Position, UpdateInfo, VaultMarket, VaultRegistryEntry } from './types.ts';
import { loadRegistry } from './config/remoteConfig.ts';
import { fetchHarbor } from './sources/harbor.ts';
import { DEFAULT_RPC, DEFAULT_CHAIN_ID, makeProvider, getVaultShares, getVaultNavOnchain } from './sources/chain.ts';
import { resolveActionPeriod } from './logic/actionPeriod.ts';
import { computePosition } from './logic/position.ts';
import { computePAlphaPosition } from './logic/position-palpha.ts';
import { fetchEmberPositionValue } from './sources/ember.ts';
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

type NavResult = { nav: number | null; apy: number; navResolvedFrom: 'onchain' | 'none' };

/**
 * Resolve NAV + APY for one vault.
 *  - NAV is ALWAYS read on-chain (ERC4626 convertToAssets via entry.onchainNav).
 *    A read failure degrades to nav:null (position still shows shares/principal)
 *    rather than dropping the whole position.
 *  - APY comes from the registry (entry.apyFallback), maintained per epoch via
 *    remote config. The vault-info API is no longer used here — its data is
 *    mostly unmaintained, and everything position needs is on-chain or in the
 *    registry.
 * Action period comes solely from actionPeriodConfig (see resolveActionPeriod).
 */
async function navFor(entry: VaultRegistryEntry, provider: ReturnType<typeof makeProvider>): Promise<NavResult> {
  const { vault, shareDecimals, assetDecimals } = entry.onchainNav;
  try {
    const nav = await getVaultNavOnchain(vault, shareDecimals, assetDecimals, provider);
    return { nav, apy: entry.apyFallback, navResolvedFrom: 'onchain' };
  } catch {
    // NAV read failed → degrade gracefully; principal/shares still reported.
    return { nav: null, apy: entry.apyFallback, navResolvedFrom: 'none' };
  }
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
      const { nav, apy, navResolvedFrom } = await navFor(entry, provider);
      const actionPeriod = resolveActionPeriod(entry, now);
      const common = { entry, sharesHuman: shares.totalHuman, nav, apy, actionPeriod, now, navResolvedFrom };

      // Vaults tracked by the Ember accounts API (pALPHA) get their value and
      // yield split from there; every other vault uses shares × NAV. An API
      // failure is surfaced but degrades to the on-chain computation.
      if (entry.emberVaultId) {
        try {
          const emberPosition = await fetchEmberPositionValue(address, entry.emberVaultId);
          if (emberPosition) {
            positions.push(computePAlphaPosition({ ...common, emberPosition }));
            return;
          }
        } catch (e) {
          errors.push({ scope: `${entry.id}:ember`, error: String((e as Error).message ?? e) });
        }
      }
      positions.push(computePosition(common));
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

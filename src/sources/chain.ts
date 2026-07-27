import { Contract, JsonRpcProvider } from 'ethers';
import type { BalanceSource } from '../types.ts';
import { formatUnits, toNumber } from '../util/money.ts';

export const DEFAULT_RPC = 'https://rpc.pharos.xyz';
export const DEFAULT_CHAIN_ID = 1672;
export const DEFAULT_ETHEREUM_RPC = 'https://ethereum-rpc.publicnode.com';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];
const VAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
];

export function makeProvider(rpcUrl: string, chainId: number): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, chainId);
}

export async function getErc20Decimals(token: string, provider: JsonRpcProvider): Promise<number> {
  const c = new Contract(token, ERC20_ABI, provider) as any;
  return Number(await c.decimals());
}

export async function getErc20Balance(token: string, holder: string, provider: JsonRpcProvider): Promise<bigint> {
  const c = new Contract(token, ERC20_ABI, provider) as any;
  return (await c.balanceOf(holder)) as bigint;
}

export async function getVaultTvl(coreVault: string, assetDecimals: number, provider: JsonRpcProvider): Promise<number> {
  const c = new Contract(coreVault, VAULT_ABI, provider) as any;
  return toNumber((await c.totalAssets()) as bigint, assetDecimals);
}

export async function getVaultNavOnchain(coreVault: string, shareDecimals: number, assetDecimals: number, provider: JsonRpcProvider): Promise<number> {
  const c = new Contract(coreVault, VAULT_ABI, provider) as any;
  const oneShare = 10n ** BigInt(shareDecimals);
  return toNumber((await c.convertToAssets(oneShare)) as bigint, assetDecimals);
}

/**
 * Resolve a balance source's RPC URL. Precedence:
 *  1. explicit per-chain override in `rpcOverrides[chainId]` (e.g. the CLI
 *     `--rpc` flag, applied to the matching chain),
 *  2. env var named by `rpcUrlEnv`,
 *  3. the source's default rpcUrl.
 */
export function resolveSourceRpc(src: BalanceSource, rpcOverrides: Record<number, string> = {}): string {
  const override = rpcOverrides[src.chainId];
  if (override && override.length > 0) return override;
  const fromEnv = src.rpcUrlEnv ? process.env[src.rpcUrlEnv] : undefined;
  return (fromEnv && fromEnv.length > 0) ? fromEnv : src.rpcUrl;
}

export interface SourceBalance {
  chainId: number;
  token: string;
  raw: bigint;
  decimals: number;
  human: string;
}

/**
 * Sum per-source raw balances into a single total, normalizing any source
 * whose decimals differ from the first source's. Pure (no I/O) — the network
 * reads happen in getVaultShares; this is the testable aggregation core.
 */
export function sumSourceBalances(ok: SourceBalance[], fallbackDecimals: number): { totalRaw: bigint; decimals: number } {
  const decimals = ok[0]?.decimals ?? fallbackDecimals;
  let totalRaw = 0n;
  for (const s of ok) {
    if (s.decimals === decimals) totalRaw += s.raw;
    else if (s.decimals < decimals) totalRaw += s.raw * 10n ** BigInt(decimals - s.decimals);
    else totalRaw += s.raw / 10n ** BigInt(s.decimals - decimals);
  }
  return { totalRaw, decimals };
}

export interface VaultShares {
  /** Total shares across all sources, human decimal string. */
  totalHuman: string;
  /** Sum of raw balances that could be read (per-source, may be partial). */
  totalRaw: bigint;
  /** Decimals used for totalRaw/totalHuman (from the first source). */
  decimals: number;
  /** Per-source successful reads. */
  sources: SourceBalance[];
  /** Per-source failures: { chainId, error }. */
  errors: Array<{ chainId: number; error: string }>;
}

/**
 * Read a vault's share/receipt-token balance across ALL its balance sources
 * (each on its own chain/provider) and sum them. pALPHA spans Pharos +
 * Ethereum; APC3M is a single Pharos source. A per-source read failure is
 * isolated (recorded in errors[]) so the other chains still contribute.
 *
 * Summation is done in raw base units. All sources for a given vault are
 * expected to share the same decimals (verified: pALPHA both = 6); if a
 * source reports different decimals it is normalized to the first source's
 * decimals before summing so totals stay correct.
 */
export async function getVaultShares(sources: BalanceSource[], holder: string, rpcOverrides: Record<number, string> = {}): Promise<VaultShares> {
  const results = await Promise.allSettled(
    sources.map(async (src): Promise<SourceBalance> => {
      const provider = makeProvider(resolveSourceRpc(src, rpcOverrides), src.chainId);
      const decimals = src.decimals ?? (await getErc20Decimals(src.token, provider));
      const raw = await getErc20Balance(src.token, holder, provider);
      return { chainId: src.chainId, token: src.token, raw, decimals, human: formatUnits(raw, decimals) };
    })
  );

  const ok: SourceBalance[] = [];
  const errors: Array<{ chainId: number; error: string }> = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') ok.push(r.value);
    else errors.push({ chainId: sources[i]!.chainId, error: String((r.reason as Error)?.message ?? r.reason) });
  });

  const decimals = ok[0]?.decimals ?? sources[0]?.decimals ?? 18;
  const { totalRaw } = sumSourceBalances(ok, decimals);

  return { totalHuman: formatUnits(totalRaw, decimals), totalRaw, decimals, sources: ok, errors };
}

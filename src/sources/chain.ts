import { Contract, JsonRpcProvider } from 'ethers';
import { formatUnits, toNumber } from '../util/money.ts';

export const DEFAULT_RPC = 'https://rpc.pharos.xyz';
export const DEFAULT_CHAIN_ID = 1672;

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

export async function getShareBalanceHuman(token: string, holder: string, provider: JsonRpcProvider): Promise<{ raw: bigint; decimals: number; human: string }> {
  const [raw, decimals] = await Promise.all([
    getErc20Balance(token, holder, provider),
    getErc20Decimals(token, provider),
  ]);
  return { raw, decimals, human: formatUnits(raw, decimals) };
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

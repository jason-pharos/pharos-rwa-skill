import type { AdviceBundle, Position, VaultId, VaultMarket } from '../types.ts';

const MARKET_NAME_BY_ID: Record<VaultId, string> = { APC3M: 'APC3M', pALPHA: 'pALPHA', 'VRPC-SemiYearly': 'VRPC-SemiYearly' };

export function buildAdvice(market: VaultMarket[], positions: Position[]): AdviceBundle {
  const heldVaultIds = positions.map((p) => p.vault);
  const heldNames = new Set(heldVaultIds.map((id) => MARKET_NAME_BY_ID[id]));
  const gapVaults = market.filter((m) => !heldNames.has(m.name) && m.tvl > 0);
  const topPicks = market.filter((m) => m.topPick === true);
  return { market, positions, heldVaultIds, gapVaults, topPicks };
}

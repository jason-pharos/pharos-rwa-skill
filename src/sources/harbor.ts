import type { VaultMarket } from '../types.ts';
import { fetchJson } from '../util/http.ts';

interface HarborRow {
  name: string; icon: string; apy: string; tvl: number;
  minimumInvestment: string[]; assetClass: string; topPick: boolean;
}
interface HarborResp { code: number; msg: string; data: HarborRow[]; }

export function parseApy(raw: string): number | null {
  const m = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  return Number(m[1]) / 100;
}

function apiBase(): string {
  return process.env.PHAROS_API_BASE ?? 'https://api.pharosnetwork.xyz';
}

export async function fetchHarbor(): Promise<VaultMarket[]> {
  const resp = await fetchJson<HarborResp>(`${apiBase()}/omni_port/harbor/summary`);
  const rows = Array.isArray(resp.data) ? resp.data : [];
  return rows.map((r) => ({
    name: r.name,
    apy: r.apy,
    apyValue: parseApy(r.apy ?? ''),
    tvl: typeof r.tvl === 'number' ? r.tvl : 0,
    minimumInvestment: Array.isArray(r.minimumInvestment) ? r.minimumInvestment : [],
    assetClass: r.assetClass ?? '',
    topPick: Boolean(r.topPick),
    icon: r.icon ?? '',
  }));
}

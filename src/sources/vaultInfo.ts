import { fetchJson } from '../util/http.ts';

export interface VaultInfo {
  apy: number | null;
  nav: number | null;
  withdrawableTs: number | null;
  minWithdrawalShares: number | null;
  phases: Array<{ startTs: number; endTs: number; apy: number | null }>;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function extractVaultInfo(data: unknown): VaultInfo {
  const d = (data ?? {}) as Record<string, any>;
  const ov = (d.overview ?? {}) as Record<string, any>;
  const vi = (d.vaultInfo ?? {}) as Record<string, any>;
  const rawPhases = Array.isArray(ov.phases) ? ov.phases : [];
  return {
    apy: num(ov.totalApy),
    nav: num(vi.receiptTokenPrice),
    withdrawableTs: num(ov.withdrawableTimestamp),
    minWithdrawalShares: num(ov.minWithdrawalShares),
    phases: rawPhases
      .map((p: any) => ({ startTs: num(p?.startTimestamp), endTs: num(p?.endTimestamp), apy: num(p?.apy) }))
      .filter((p: any) => p.startTs !== null && p.endTs !== null) as VaultInfo['phases'],
  };
}

function apiBase(): string {
  return process.env.PHAROS_API_BASE ?? 'https://api.pharosnetwork.xyz';
}

export async function fetchVaultInfo(vaultId: string): Promise<VaultInfo> {
  const resp = await fetchJson<{ data: unknown }>(`${apiBase()}/omni_port/vault/info?vaultId=${vaultId}`);
  return extractVaultInfo(resp.data);
}

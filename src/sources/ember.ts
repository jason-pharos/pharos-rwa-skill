import { AccountsApi, Configuration, type PositionValue } from '@ember-finance/sdk/api/v2';
import { getAddress } from 'ethers';
import { PHAROS_HEADERS } from '../util/http.ts';

const TIMEOUT_MS = 12000;

function apiBase(): string {
  return process.env.PHAROS_API_BASE ?? 'https://api.pharosnetwork.xyz';
}

function accountsApi(): AccountsApi {
  return new AccountsApi(new Configuration({
    basePath: `${apiBase()}/omni_port/ember`,
    baseOptions: { timeout: TIMEOUT_MS, headers: { accept: 'application/json', ...PHAROS_HEADERS } },
  }));
}

/**
 * Vault-level position aggregate from the Ember accounts API
 * (GET /omni_port/ember/api/v2/vaults/positions/account/{address}?vaultId=...).
 *
 * Chain-agnostic: the API already sums the holder's shares across every chain
 * the vault lives on, and reports position value + realized/unrealized yield
 * that no single on-chain read can give us.
 *
 * The address is checksummed first: the API matches it byte-for-byte and
 * returns an empty list for a lower-cased address that in fact holds shares.
 *
 * Returns null when the account has no position in that vault. Throws on
 * network/API failure — callers fall back to the on-chain computation.
 */
export async function fetchEmberPositionValue(address: string, vaultId: string): Promise<PositionValue | null> {
  const res = await accountsApi().getAccountPositionsValue(getAddress(address), vaultId);
  const rows = Array.isArray(res.data) ? res.data : [];
  // The vaultId filter is server-side, but re-check: a stale/ignored filter
  // must not silently attribute another vault's numbers to this one.
  return rows.find((p) => p.vaultId === vaultId) ?? null;
}

export type { PositionValue };

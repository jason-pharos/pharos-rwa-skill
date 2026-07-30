import type { ActionPeriod, Redeemable, VaultRegistryEntry } from '../types.ts';
import type { RawRedeemability } from '../sources/chain.ts';
import type { R25VaultPeriod } from '../sources/r25.ts';
import { isoToSec, secToIso, windowState } from '../util/time.ts';

function build(startTs: number | null, endTs: number | null, withdrawableTs: number | null, source: ActionPeriod['source'], now: number): ActionPeriod {
  if (startTs === null || endTs === null) {
    return { start: null, end: null, startTs: null, endTs: null, withdrawableDate: null, source: 'unavailable', isOpen: false, opensInDays: null, closesInDays: null, stale: false };
  }
  const st = windowState(startTs, endTs, now);
  return {
    start: secToIso(startTs),
    end: secToIso(endTs),
    startTs, endTs,
    withdrawableDate: withdrawableTs !== null ? secToIso(withdrawableTs).slice(0, 10) : null,
    source,
    isOpen: st.isOpen,
    opensInDays: st.opensInDays,
    closesInDays: st.closesInDays,
    stale: st.stale,
  };
}

/**
 * Config-based action period (APC3M, pALPHA): a fixed withdraw window from the
 * per-epoch configured dates (maintained in the registry / config/vaults.json).
 * Vaults without actionPeriodConfig (redeemability-based, e.g. VRPC-SemiYearly)
 * are handled by resolveRedeemableActionPeriod instead.
 */
export function resolveActionPeriod(entry: VaultRegistryEntry, now: number): ActionPeriod {
  const cfg = entry.actionPeriodConfig;
  if (!cfg) return build(null, null, null, 'unavailable', now);
  const startTs = isoToSec(cfg.actionStart);
  const endTs = isoToSec(cfg.actionEnd);
  const wTs = isoToSec(cfg.withdrawable);
  if (startTs !== null && endTs !== null) return build(startTs, endTs, wTs, 'config', now);
  return build(null, null, null, 'unavailable', now);
}

/**
 * R25-API-based action period (APC3M): dynamic window dates from the R25
 * /dapp/vault/period endpoint. Replaces hardcoded actionPeriodConfig when the
 * API is reachable; falls back to config otherwise.
 */
export function resolveR25ActionPeriod(period: R25VaultPeriod, now: number): ActionPeriod {
  const startTs = period.withdrawalWindowStart != null ? Math.floor(period.withdrawalWindowStart / 1000) : null;
  const endTs = period.withdrawalWindowEnd != null ? Math.floor(period.withdrawalWindowEnd / 1000) : null;
  const maturityTs = period.nextMaturityDate != null ? Math.floor(period.nextMaturityDate / 1000) : null;
  return build(startTs, endTs, maturityTs, 'r25-api', now);
}

/**
 * Redeemability-based action period (VRPC-SemiYearly / VRPC-Weekly): no fixed
 * dates. The "withdraw window" is how much is redeemable RIGHT NOW, read live
 * from the contract. `isOpen` = something is redeemable or in flight
 * (max/pending/claimable > 0); there are no opens/closes-in-days (the exact
 * maturity date is not on-chain). `lockDays` is passed through for reminder
 * wording only (7 for Weekly, 184 for SemiYearly).
 *
 * NOTE: `walletShares` is the balanceOf in the holder's wallet. The ERC-7540
 * async variant's requestRedeem escrows shares OUT of the wallet, so the
 * holder's TOTAL position = walletShares + pending + claimable. fullyRedeemable
 * compares maxRedeem against that total, not the (possibly depleted) wallet
 * balance. For the ERC-4626 sync variant pending/claimable are 0, so this
 * reduces to walletShares.
 */
export function resolveRedeemableActionPeriod(raw: RawRedeemability, walletShares: number, nav: number | null, lockDays: number, isAsync: boolean): ActionPeriod {
  const totalPosition = walletShares + raw.pendingRedeemShares + raw.claimableRedeemShares;
  const redeemable: Redeemable = {
    maxRedeemShares: raw.maxRedeemShares,
    maxRedeemValue: nav != null ? raw.maxRedeemShares * nav : null,
    pendingRedeemShares: raw.pendingRedeemShares,
    claimableRedeemShares: raw.claimableRedeemShares,
    fullyRedeemable: totalPosition > 0 && raw.maxRedeemShares >= totalPosition,
    lockDays,
    async: isAsync,
  };
  const isOpen = raw.maxRedeemShares > 0 || raw.claimableRedeemShares > 0 || raw.pendingRedeemShares > 0;
  return {
    start: null, end: null, startTs: null, endTs: null, withdrawableDate: null,
    source: 'onchain-redeemable',
    isOpen,
    opensInDays: null, closesInDays: null,
    stale: false,
    redeemable,
  };
}


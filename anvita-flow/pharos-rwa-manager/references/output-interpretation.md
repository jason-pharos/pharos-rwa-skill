# Output Interpretation Reference

How to read every field the CLI returns. Read this before reporting anything you
do not recognize. Top-level shape is always `{ ok, generatedAt, updateAvailable?, data, errors }`.

## Top level

- `updateAvailable` present → mention that a newer version of the skill exists so the operator can refresh the package. Do not run `cli.js upgrade` — updates are host-managed (see SKILL.md → Execution Instructions).
- `errors[]` lists per-scope failures; other data is still valid (partial success). Always surface these to the client as "partial success" notes.

## Position fields — estimated vs real

- Check `estimated` and `assumptions.valueResolvedFrom`.
  - `estimated: false` + `valueResolvedFrom: "r25-api"` or `"ember-api"` → earnings/principal are real data from the vault's API, not approximations.
  - `estimated: true` → say "约 / estimated" for `principal` / `realizedYield` / `expectedTotalYield`.
- `assumptions.valueResolvedFrom: "ember-api"` (pALPHA) → value/yield came from the vault's own accounts API, so `principal` is the real cost basis rather than an entry-NAV approximation — the most trustworthy numbers. Such positions also carry `yieldBreakdown` (`realized` = already settled, `unrealized` = still in the position, `total` = `realizedYield`). Without that assumption the position fell back to on-chain `shares × NAV`; check `errors[]` for a `<vault>:ember` entry.
- `shares: null` with `assumptions.sharesResolvedFrom: "unavailable"` → every chain's balance read failed; the wallet balance is UNKNOWN, not zero. The position is still reported because an off-chain book of record (the Ember accounts API, pALPHA) knows it, so `currentValue` and yield figures remain trustworthy. Say the share count could not be read; never report it as 0. Per-chain reasons are in `errors[]` as `<vault>:chain-<chainId>`.

## R25-backed vaults (APC3M, VRPC-SemiYearly, VRPC-Weekly)

- `assumptions.valueResolvedFrom: "r25-api"` → earnings/NAV came from the R25 dApp API. The `r25` field carries real data: `earnings` (actual yield, not estimated), `baseApy` (base APY before boost), and `boost` (channel-specific incentive — e.g. TopNod +3% for VRPC vaults, `null` when no boost applies). The APY used for `expectedTotalYield` projection is `baseApy + boost.boostApy`.
- `r25.tranches` (APC3M, VRPC-SemiYearly only) → per-deposit breakdown from the R25 positions API. Each tranche is one deposit with its own `expirationDate`, `daysUntilExpiration`, and `amountUsdc`, sorted by expiration ascending. For VRPC-SemiYearly (184-day lock from each deposit) this gives exact per-tranche unlock dates the on-chain contract cannot provide. `r25.redemptionFreezeWindowMs` is the freeze window before settlement (VRPCS: 7 days = must request redemption at least 7 days before maturity). Absent for VRPC-Weekly (positions API unsupported).
- An `errors[]` entry scoped `r25` or `r25:<endpoint>` → the R25 dApp API did not answer, so R25-backed vaults fell back to on-chain reads and may lack `r25` earnings/tranche data. pALPHA is unaffected — it never uses R25.
- A `Timestamp invalid (R0003_00001)` message specifically means the machine's clock has drifted: tell the client to fix the system clock, since every R25 call keeps failing until then.

## APY channels (购买渠道与 APY)

The same vault offers different APY depending on where you buy. In `vaults`/`advise` output, `apy`/`apyValue` (from harbor) is the boosted rate and `r25BaseApy` is the base rate on the R25 website. Current channels:

- **APC3M** (Axil Prime 3M): R25/TopNod = 13% base; Pharos (port.pharos.xyz/apc) = 14.3% (+1.3% boost)
- **VRPC-SemiYearly** (Axil Consumer Credit - 6M): R25 = 12% base; TopNod = 15% (+3% boost)
- **VRPC-Weekly** (Axil Consumer Credit - 7D): R25 = 5% base; TopNod = 8% (+3% boost)

## Yield terms

- `realizedYield` is yield earned SO FAR (cumulative since deposit, may span earlier epochs).
- `expectedTotalYield` is forward-looking for every vault — earned-to-date plus APY applied to the remaining lock time (`assumptions.expectedYieldBasis`) — a projection for lock end, not an extra amount on top of `realizedYield`.

## Action period vs withdrawable date

- `actionPeriod.end` (withdraw-request deadline) and `withdrawableDate` (when funds actually come back) are different dates: for pALPHA the request window closes 2026-10-01 but funds are withdrawable 2026-10-20. Don't conflate them when reminding the client.
- `actionPeriod.source` is `config`, `onchain-redeemable`, `r25-api`, or `unavailable`. `r25-api` may carry either (a) dynamic window dates from the R25 `/dapp/vault/period` endpoint (APC3M windowed) or (b) a `redeemable` field with per-tranche data (see below). If `unavailable`, say the withdraw window is currently unknown.

## Redeemability-based vaults (VRPC-SemiYearly, VRPC-Weekly)

`actionPeriod.source` is `"onchain-redeemable"` or `"r25-api"` with `redeemable`. These vaults have NO fixed withdraw window; the lock runs from each user's OWN deposit and the contract exposes no per-user deposit or maturity date, so we report live redeemability instead of dates.

- **When R25 positions data is available (VRPC-SemiYearly)**, source is `"r25-api"` with a `redeemable` field — the on-chain `maxRedeem` is SKIPPED because it only returns one settlement window's shares (misleading for ERC-7540). Instead `maxRedeemShares` is the sum of ALL non-expired tranche shares from the R25 API, representing the full amount the client can request for withdrawal before their respective expiration dates.
- **When R25 positions data is unavailable (VRPC-Weekly or API down)**, the fallback `"onchain-redeemable"` source is used with direct on-chain reads.
- VRPC-SemiYearly is ERC-7540 async (redeem must be requested, then settled, then claimed); VRPC-Weekly is plain ERC-4626 sync (redeem directly → pending/claimable stay 0).

Limitations to convey honestly:

1. **Exact dates only from R25 tranches.** When `r25.tranches` is present (APC3M, VRPC-SemiYearly via R25 positions API), each tranche has an exact `expirationDate` — present as per-tranche unlock dates. `actionPeriod.redeemable.maxRedeemShares` is the sum of all non-expired tranche shares — ALL are requestable for withdrawal (not just one settlement window's worth). The reminder message says "requestable for withdrawal now (all non-expired tranche shares)" for `r25-api` source with redeemable data. When tranches are absent (VRPC-Weekly or API down), there is NO unlock/maturity date — do NOT state or guess one; convey the rule as "`lockDays`-day lock from deposit". `depositedDurationDays`, `lockEnd`, and `expectedTotalYield` remain `null` for redeemability-based vaults.
2. **Cost basis: real when R25 data available, approximation otherwise.** When `assumptions.valueResolvedFrom: "r25-api"`, `realizedYield` is actual earnings from the R25 API and `principal` is derived from it (currentValue − earnings) — real numbers. When R25 data is unavailable, the position falls back to `estimated: true` with `assumptions.entryNav` (entry NAV = 1 approximation) — say "约 / estimated".

## Other error scopes

- A `<vault>:redeemability` entry means the on-chain redeemability read failed (RPC issue) — withdraw status is unknown, NOT "locked".
- A `<vault>:chain-<chainId>` entry means a specific chain's balance read failed (see "shares: null" above).

## Updates

Version updates are host-managed: the operator reinstalls the package. The bundled `upgrade` command is out of scope for this skill — do not run it, and do not report upgrade results.

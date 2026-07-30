---
name: pharos-rwa-manager
description: "Inspect and manage a user's Pharos RWA vault holdings (APC3M, pALPHA, VRPC-SemiYearly, VRPC-Weekly): position value and estimated yield, action-period / withdraw-window reminders, live market overview, and buy/allocation advice. Use this skill whenever the user asks about their Pharos or RWA vault position, APC3M / pALPHA / VRPC holdings/收益, when they can withdraw or redeem (action period / 什么时候能赎回 / when can I withdraw), which vault to buy or whether to add a new one (该买哪个金库 / Pharos vault 建议), or wants the harbor 金库概览 / open-vault overview — even if they don't name the vault or say 'skill' explicitly. Runs read-only via a zero-dependency CLI given the user's address."
metadata:
  user-invocable: "true"
  arguments: "vaults | position <address> | reminders <address> | advise <address> | upgrade"
  entry: "cli.js"
  requires: "nodejs>=18"
  tags: "pharos, rwa, apc3m, palpha, vrpc, vault, defi, action-period, tooling"
---

# Pharos RWA Manager

Zero-dependency CLI to inspect Pharos RWA vault positions and market data. Output is a single JSON object on stdout; translate its fields into natural language in the user's language (Chinese or English). Errors are single-line JSON on stderr.

## When to use / 何时使用
- User asks about their RWA position / 我的 RWA 持仓、收益、已存多久
- User asks when they can withdraw / 什么时候能赎回、action period
- User asks which vault to buy / 该买哪个金库、有什么新机会
- User asks for the open-vault overview / 当前开放的金库概览
- Scheduled/proactive: a daily job to remind the user of upcoming action
  periods and surface new vault opportunities / 每日定时提醒 action period、
  收集最新金库信息（见下方 "Proactive / scheduled use"）

## How to use / 如何使用

Market overview of all vaults (no address needed):

```bash
node cli.js vaults
```

A user's position overview (APC3M + pALPHA + VRPC-SemiYearly + VRPC-Weekly):

```bash
node cli.js position 0xYourAddress
```

Action-period reminders (which vaults can be withdrawn soon):

```bash
node cli.js reminders 0xYourAddress
```

Advice bundle (market + position + vaults the user does not yet hold):

```bash
node cli.js advise 0xYourAddress
```

Self-update the CLI from the latest GitHub Release:

```bash
node cli.js upgrade
```

Add `--pretty` to any command for indented JSON. Add `--no-remote` to skip remote config and version checks (offline).

## Wallet addresses / 钱包地址

The skill is stateless — it does NOT store or remember any address. A wallet
address is just a positional argument passed per call, validated as
`0x` + 40 hex (invalid → `{"error":...}` on stderr, exit 2).

Remembering *which* address(es) to track is the calling agent's job:

- Ask the user for their Pharos address once ("帮我盯着 0x… / track 0x… for me")
  and persist it in the agent's own memory/store, keyed to the user.
- On each scheduled run (or follow-up question), read the stored address and
  pass it to the CLI. Support multiple addresses per user by looping the
  command over each.
- 地址由 agent 记忆并按用户存储；skill 每次只接收一个地址参数，不做持久化。

If the user has not provided an address yet, ask for it before running
`position` / `reminders` / `advise`. (`vaults` needs no address.)

## Proactive / scheduled use / 定期主动使用

This skill is read-only and does NOT schedule itself. The calling agent
(openclaw / hermes / cron) is responsible for running it on a schedule and
delivering results to the user (e.g. via Telegram). The skill only returns
JSON; the agent decides cadence and delivery channel. Addresses come from
the agent's stored memory (see "Wallet addresses" above).

Recommended daily job, per tracked user address:

- **Action-period reminders (核心)** — run `reminders` daily; if any held
  vault's `urgency` is `opening-soon`, `open`, or `closing-soon`, proactively
  message the user that they can (soon) start a withdraw. 每日跑，action
  period 即将开启/进行中/即将关闭时主动提醒用户。

  ```bash
  node cli.js reminders 0xUserAddress
  ```

- **Latest vault info + buy advice** — run `vaults` (market-wide, no address)
  or `advise` (personalized) daily; when a new `topPick` appears or a
  high-APY vault the user does not hold shows up (`gapVaults`), prompt whether
  it is worth buying. 每日收集最新金库信息，出现新机会时提示是否值得买入。

  ```bash
  node cli.js advise 0xUserAddress
  ```

Only notify the user when there is something actionable (an urgency worth
acting on, or a genuinely new opportunity) — do not send an empty daily ping.

## Interpreting output

- Top level: `{ ok, generatedAt, updateAvailable?, data, errors }`. If `updateAvailable` is present, tell the user a newer version exists and they can run `node cli.js upgrade`.
- Position fields may be ESTIMATES or REAL: check `estimated` and `assumptions.valueResolvedFrom`. When `estimated: false` and `valueResolvedFrom: "r25-api"` or `"ember-api"`, the earnings/principal are real data from the vault's API, not approximations. When `estimated: true`, say "约/estimated" for `principal`/`realizedYield`/`expectedTotalYield`.
- `assumptions.valueResolvedFrom: "ember-api"` (pALPHA) means value/yield came from the vault's own accounts API, so `principal` is the real cost basis rather than an entry-NAV approximation — those numbers are the most trustworthy. Such positions also carry `yieldBreakdown` (`realized` = already settled, `unrealized` = still in the position, `total` = `realizedYield`). Without that assumption the position fell back to on-chain `shares × NAV`; check `errors[]` for a `<vault>:ember` entry.
- `assumptions.valueResolvedFrom: "r25-api"` (APC3M, VRPC-SemiYearly, VRPC-Weekly) means earnings/NAV came from the R25 dApp API. The `r25` field carries real data: `earnings` (actual yield, not estimated), `baseApy` (base APY before boost), and `boost` (channel-specific incentive — e.g. TopNod +3% for VRPC vaults, `null` when no boost applies). The position's APY used for `expectedTotalYield` projection is `baseApy + boost.boostApy`.
- `r25.tranches` (APC3M, VRPC-SemiYearly only) — per-deposit breakdown from the R25 positions API. Each tranche is one deposit with its own `expirationDate`, `daysUntilExpiration`, and `amountUsdc`. Tranches are sorted by expiration date ascending. For VRPC-SemiYearly (184-day lock from each deposit), this gives exact per-tranche unlock dates that the on-chain contract cannot provide. `r25.redemptionFreezeWindowMs` is the freeze window before settlement (VRPCS: 7 days = must request redemption at least 7 days before maturity). Absent for VRPC-Weekly (positions API unsupported).
- **APY channels / 购买渠道与 APY**: the same vault offers different APY depending on where you buy. In `vaults`/`advise` output, `apy`/`apyValue` (from harbor) is the boosted rate and `r25BaseApy` is the base rate on the R25 website. Current channels:
  - **APC3M** (Axil Prime 3M): R25/TopNod = 13% base; Pharos (port.pharos.xyz/apc) = 14.3% (+1.3% boost)
  - **VRPC-SemiYearly** (Axil Consumer Credit - 6M): R25 = 12% base; TopNod = 15% (+3% boost)
  - **VRPC-Weekly** (Axil Consumer Credit - 7D): R25 = 5% base; TopNod = 8% (+3% boost)
- `realizedYield` is yield earned SO FAR (cumulative since the holder deposited, which may span earlier epochs). `expectedTotalYield` is forward-looking for every vault — earned-to-date plus APY applied to the remaining lock time (`assumptions.expectedYieldBasis`) — so it is a projection for lock end, not an extra amount on top of `realizedYield`.
- `actionPeriod.end` (withdraw-request deadline) and `withdrawableDate` (when funds actually come back) are different dates: for pALPHA the request window closes 2026-10-01 but funds are withdrawable 2026-10-20. Don't conflate them when reminding the user.
- `actionPeriod.source` is `config`, `onchain-redeemable`, `r25-api`, or `unavailable`. `r25-api` may carry either (a) dynamic window dates from the R25 `/dapp/vault/period` endpoint (APC3M windowed) or (b) a `redeemable` field with per-tranche data (see below). If `unavailable`, say the withdraw window is currently unknown.
- **Redeemability-based vaults (VRPC-SemiYearly, VRPC-Weekly), `actionPeriod.source` is `"onchain-redeemable"` or `"r25-api"` with `redeemable`** — these vaults have NO fixed withdraw window; the lock runs from each user's OWN deposit and the contract exposes no per-user deposit or maturity date, so we report live redeemability instead of dates. **When R25 positions data is available (VRPC-SemiYearly), the action period source is `"r25-api"` with a `redeemable` field — the on-chain `maxRedeem` is SKIPPED because it only returns one settlement window's shares (misleading for ERC-7540).** Instead, `maxRedeemShares` is the sum of ALL non-expired tranche shares from the R25 API, representing the full amount the user can request for withdrawal before their respective expiration dates. When R25 positions data is unavailable (VRPC-Weekly or API down), the fallback `"onchain-redeemable"` source is used with direct on-chain reads. VRPC-SemiYearly is ERC-7540 async (redeem must be requested, then settled, then claimed); VRPC-Weekly is plain ERC-4626 sync (redeem directly → pending/claimable stay 0). Limitations to convey honestly:
  1. **Exact dates from R25 tranches when available, otherwise no exact dates.** When `r25.tranches` is present (APC3M, VRPC-SemiYearly via R25 positions API), each tranche has an exact `expirationDate`. Present these as per-tranche unlock dates. `actionPeriod.redeemable.maxRedeemShares` is the sum of all non-expired tranche shares — ALL of them are requestable for withdrawal (not just one settlement window's worth, which is the misleading on-chain `maxRedeem` for ERC-7540). The reminder message says "requestable for withdrawal now (all non-expired tranche shares)" for `r25-api` source with redeemable data. When tranches are absent (VRPC-Weekly or API down), there is NO unlock/maturity date available — do NOT state or guess one; convey the rule as "`lockDays`-day lock from deposit" and the on-chain fallback message. `depositedDurationDays`, `lockEnd`, and `expectedTotalYield` remain `null` for redeemability-based vaults.
  2. **Cost basis: real when R25 data available, approximation otherwise.** When `assumptions.valueResolvedFrom: "r25-api"`, `realizedYield` is the actual earnings from the R25 API and `principal` is derived from it (currentValue − earnings) — these are real numbers, not estimates. When R25 data is unavailable (API down), the position falls back to `estimated: true` with `assumptions.entryNav` (entry NAV = 1 approximation) — say "约/estimated" in that case.
- `errors[]` lists per-scope failures; other data is still valid (partial success). A `<vault>:redeemability` entry means the on-chain redeemability read failed (RPC issue) — in that case the withdraw status is unknown, NOT "locked".

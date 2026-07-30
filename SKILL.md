---
name: pharos-rwa-manager
description: "Inspect and manage a user's Pharos RWA vault holdings (APC3M, pALPHA, VRPC-SemiYearly): position value and estimated yield, action-period / withdraw-window reminders, live market overview, and buy/allocation advice. Use this skill whenever the user asks about their Pharos or RWA vault position, APC3M / pALPHA / VRPC holdings/收益, when they can withdraw or redeem (action period / 什么时候能赎回 / when can I withdraw), which vault to buy or whether to add a new one (该买哪个金库 / Pharos vault 建议), or wants the harbor 金库概览 / open-vault overview — even if they don't name the vault or say 'skill' explicitly. Runs read-only via a zero-dependency CLI given the user's address."
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

A user's position overview (APC3M + pALPHA + VRPC-SemiYearly):

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
- Position fields are ESTIMATES: `estimated: true` with `assumptions` (entry NAV baseline). Say "约/estimated", not exact figures, for `principal`/`realizedYield`/`expectedTotalYield`.
- `assumptions.valueResolvedFrom: "ember-api"` (pALPHA) means value/yield came from the vault's own accounts API, so `principal` is the real cost basis rather than an entry-NAV approximation — those numbers are the most trustworthy. Such positions also carry `yieldBreakdown` (`realized` = already settled, `unrealized` = still in the position, `total` = `realizedYield`). Without that assumption the position fell back to on-chain `shares × NAV`; check `errors[]` for a `<vault>:ember` entry.
- `realizedYield` is yield earned SO FAR (cumulative since the holder deposited, which may span earlier epochs). `expectedTotalYield` is forward-looking for every vault — earned-to-date plus APY applied to the remaining lock time (`assumptions.expectedYieldBasis`) — so it is a projection for lock end, not an extra amount on top of `realizedYield`.
- `actionPeriod.end` (withdraw-request deadline) and `withdrawableDate` (when funds actually come back) are different dates: for pALPHA the request window closes 2026-10-01 but funds are withdrawable 2026-10-20. Don't conflate them when reminding the user.
- `actionPeriod.source` is `config`, `onchain-redeemable`, or `unavailable`. If `unavailable`, say the withdraw window is currently unknown.
- **Redeemability-based vaults (VRPC-SemiYearly), `actionPeriod.source: "onchain-redeemable"`** — this vault has NO fixed withdraw window and its lock is 184 days from each user's OWN deposit; the contract exposes no per-user deposit or maturity date, so we report live on-chain redeemability instead of dates. Two limitations to convey honestly to the user:
  1. **No exact dates.** `actionPeriod.redeemable` tells you how much is actionable RIGHT NOW — `maxRedeemShares`/`maxRedeemValue` (redeemable now), `pendingRedeemShares` (requested, awaiting settlement), `claimableRedeemShares` (settled, claim now), `fullyRedeemable`. There is NO unlock/maturity date available — do NOT state or guess one. The rule is "184-day lock from deposit; request a withdraw ≥7 days before maturity." `depositedDurationDays`, `lockEnd`, and `expectedTotalYield` are `null` for this vault (deposit time is unknown on-chain) — present them as "unknown", not as 0 or a computed value.
  2. **Cost basis is an approximation.** `principal`/`realizedYield` assume entry NAV = 1 (`assumptions.entryNav`). This vault has no per-user cost-basis API (unlike pALPHA), so if the user bought in multiple tranches or at a different NAV, actual principal/yield differ. Say "约/estimated" and note the entry-NAV assumption.
- `errors[]` lists per-scope failures; other data is still valid (partial success). A `<vault>:redeemability` entry means the on-chain redeemability read failed (RPC issue) — in that case the withdraw status is unknown, NOT "locked".

---
name: pharos-rwa-manager
description: "Manage Pharos RWA vault positions (APC3M, pALPHA). Triggers: RWA 持仓, action period 提醒, 什么时候能赎回, when can I withdraw, Pharos vault 建议, 该买哪个金库, my APC3M position, pALPHA 收益, harbor 金库概览"
metadata:
  user-invocable: "true"
  arguments: "vaults | position <address> | reminders <address> | advise <address> | upgrade"
  entry: "cli.js"
  requires: "nodejs>=18"
  tags: "pharos, rwa, apc3m, palpha, vault, defi, action-period, tooling"
---

# Pharos RWA Manager

Zero-dependency CLI to inspect Pharos RWA vault positions and market data. Output is a single JSON object on stdout; translate its fields into natural language in the user's language (Chinese or English). Errors are single-line JSON on stderr.

## When to use / 何时使用
- User asks about their RWA position / 我的 RWA 持仓、收益、已存多久
- User asks when they can withdraw / 什么时候能赎回、action period
- User asks which vault to buy / 该买哪个金库、有什么新机会
- User asks for the open-vault overview / 当前开放的金库概览

## How to use / 如何使用

Market overview of all vaults (no address needed):

```bash
node cli.js vaults
```

A user's position overview (APC3M + pALPHA):

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

## Interpreting output

- Top level: `{ ok, generatedAt, updateAvailable?, data, errors }`. If `updateAvailable` is present, tell the user a newer version exists and they can run `node cli.js upgrade`.
- Position fields are ESTIMATES: `estimated: true` with `assumptions` (entry NAV baseline). Say "约/estimated", not exact figures, for `principal`/`realizedYield`/`expectedTotalYield`.
- `actionPeriod.source` is `api`, `config`, or `unavailable`. If `unavailable`, say the withdraw window is currently unknown.
- `errors[]` lists per-scope failures; other data is still valid (partial success).

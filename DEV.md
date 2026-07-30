# Development

## Setup

```bash
git clone <repo-url>
cd pharos-rwa-skill
npm install
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev -- <args>` | Run CLI from TS source (e.g. `npm run dev -- position 0x...`) |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Run all 80+ unit tests (no network needed) |
| `npm run build` | Bundle `cli.js` via esbuild |

## Project Layout

```
src/
  cli.ts              — CLI entry point (commander)
  index.ts            — Core logic: buildPositions, runVaults, runReminders, etc.
  types.ts            — All TypeScript types/interfaces
  sources/
    r25.ts            — R25 dApp API client (rate-limited POST)
    chain.ts          — On-chain reads (balanceOf, NAV, redeemability)
    harbor.ts         — Harbor market API
    ember.ts          — Ember accounts API (pALPHA)
  config/
    registry.ts       — Vault registry (contract addresses, RPCs, APY fallbacks)
    remoteConfig.ts   — Remote config overrides
  logic/
    actionPeriod.ts   — Action period resolution (config, on-chain, R25)
    position.ts       — Position computation
    position-palpha.ts— pALPHA-specific position logic
    reminders.ts      — Reminder builder
    advise.ts         — Advice builder
  util/
    time.ts           — Time helpers
    money.ts          — Number/unit formatting
    http.ts           — HTTP helpers
```

## Release Flow

```bash
# 1. Auto-runs: typecheck → test → build → bump → commit → tag → push
npm version patch        # 0.2.0 → 0.2.1
npm version minor        # 0.2.0 → 0.3.0
npm version major        # 0.2.0 → 1.0.0

# 2. Create GitHub Release with cli.js + SKILL.md
gh release create v$(node -p 'require("./package.json").version') \
  --title "v$(node -p 'require("./package.json").version')" \
  --notes-file <(cat) ./cli.js ./SKILL.md
```

Users install via release assets only (`cli.js` + `SKILL.md`), not the full repo.

The `preversion` hook runs `typecheck && test && build` before bumping — `cli.js` in the release always matches the version tag.

## Data Sources

- **R25 API** (`app.r25.xyz/dapp`): holdings, positions/tranches, activity, vault periods — primary data for APC3M, VRPCS, VRPCW
- **Harbor API** (`api.pharosnetwork.xyz/omni_port/harbor/summary`): market overview (APY, TVL with channel boosts)
- **Pharos RPC** (`rpc.pharos.xyz`): on-chain NAV, balanceOf, redeemability
- **Ethereum RPC** (`ethereum-rpc.publicnode.com` + fallbacks): pALPHA balance on Ethereum

### Vault Types & Action Period Sources

| Vault | Type | Action Period Source |
|-------|------|---------------------|
| APC3M | ERC-4626 sync, windowed | R25 `/vault/period` (dynamic dates) |
| pALPHA | ERC-4626 sync | Config-based fixed dates |
| VRPC-SemiYearly | ERC-7540 async | R25 positions API (all non-expired tranches) |
| VRPC-Weekly | ERC-4626 sync | On-chain `maxRedeem` (accurate for sync) |

VRPC-SemiYearly uses R25 positions data to override on-chain `maxRedeem` (which is misleading for ERC-7540 — only returns one settlement window). VRPC-Weekly stays on-chain because `maxRedeem` is accurate for sync vaults.

VRPCW tranches are derived from `/portfolio/activity` deposit records (positions API returns "Unsupported vault").

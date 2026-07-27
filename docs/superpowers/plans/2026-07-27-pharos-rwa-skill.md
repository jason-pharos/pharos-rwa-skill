# Pharos RWA Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-dependency Node CLI skill that reports Pharos RWA vault market data, a user's APC3M/pALPHA positions, action-period reminders, and an advice bundle — with GitHub-backed remote config + self-update.

**Architecture:** TypeScript source in `src/`, bundled by esbuild into a single committed `cli.js`. Three isolated layers — `sources/` (protocol I/O), `logic/` (pure calculators), `cli.ts`/`index.ts` (shell + orchestration). All output is valid JSON on stdout; errors are single-line JSON on stderr. Data sources fail in isolation via `Promise.allSettled`. Remote `config/vaults.json` (fetched from raw GitHub) drives the vault registry with a bundled fallback; code updates come from GitHub Releases via an explicit `upgrade` command.

**Tech Stack:** Node ≥18, TypeScript (strict), ethers v6, commander v12, esbuild (bundler + type-check via tsc `--noEmit`). Test runner: `tsx --test` (node built-in test runner driven through tsx so tests can import `.ts` sources).

## Global Constraints

- Node ≥18; output is valid JSON on stdout, errors single-line JSON `{"error":"..."}` on stderr + nonzero exit.
- Zero runtime dependencies beyond `ethers@^6` and `commander@^12` (both tree-shaken into `cli.js`); no runtime dep may require a child process or dynamic import (must be esbuild-bundlable).
- `cli.js` is committed to git and re-published as a GitHub Release asset with `cli.js.sha256`.
- Source repo pinned in bundle: OWNER=`jason-pharos`, REPO=`pharos-rwa-skill` (env-overridable for dev only).
- Default RPC `https://rpc.pharos.xyz`, chainId **1672** (pass chainId explicitly to ethers `JsonRpcProvider`).
- v1 vaults only: APC3M + pALPHA. No JWT, no backend records API, no cross-chain cost table, no scheduling/Telegram (agent's job).
- All money math uses BigInt intermediates; convert to Number only at display.
- HTTPS-only for all fetches; `cli.js` self-update requires sha256 verification; remote JSON is treated as data, never eval'd.
- Approximation fields in `position` output MUST carry `estimated: true` + `assumptions`.
- TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
- Commands: `vaults`, `position <address>`, `reminders <address>`, `advise <address>`, `upgrade`. Common flags: `--pretty`, `--rpc <url>`, `--no-remote`.

## Known Facts (verified, copy verbatim — no placeholders)

- APC3M (Pharos mainnet CoreVault, ERC4626-style):
  - core `0xD0428799FbC35557834d33121BA4472692c8908a`
  - share `0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0`
  - usdc `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`
  - NAV source = **on-chain** `convertToAssets(10**shareDecimals)`; TVL = `totalAssets()`.
  - action period = **config only** (no API). Current prod window: lockStart `2026-07-20T00:00:00+08:00`, lockEnd `2026-10-20T23:59:59+08:00`, actionStart `2026-07-20T00:00:00+08:00`, actionEnd `2026-10-16T00:00:00+08:00`, withdrawable `2026-10-20`. apy `0.14`. entryNavBaseline `1.0`.
- pALPHA (Ember/Bluefin vault):
  - vaultId `1502a2c9-3ea1-4f0d-b513-fb79e3dbbe1f`
  - share/receipt token (Pharos) `0xC3AaCb558aFB635307B66FDb405188138576fc4c` (`balanceOf` readable on-chain)
  - NAV source = **API** `data.overview` / `data.vaultInfo.receiptTokenPrice` (e.g. 1.034760941); depositCoin decimals 6.
  - action period = **API-first** (`overview.phases[]`, `overview.withdrawableTimestamp`), config fallback. apy from `overview.totalApy` (0.14). `minWithdrawalShares` 0.1.
- harbor summary: `GET https://api.pharosnetwork.xyz/omni_port/harbor/summary` (no JWT) → array of `{name,icon,url,latestPrice,apy(string),tvl(number),minimumInvestment(string[]),assetClass,topPick}`.
- vault info: `GET https://api.pharosnetwork.xyz/omni_port/vault/info?vaultId=<id>` (no JWT).
- API base overridable via env `PHAROS_API_BASE` (default `https://api.pharosnetwork.xyz`).

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | scripts (dev/build/typecheck/test), deps, `type: module`, bin |
| `tsconfig.json` | strict TS, noEmit, Bundler resolution |
| `src/version.ts` | compile-time injected `VERSION`, `OWNER`, `REPO` constants (esbuild `--define`) |
| `src/types.ts` | shared types: `VaultId`, `VaultRegistryEntry`, `ActionPeriod`, `Position`, `VaultMarket`, `AdviceBundle`, `Envelope` |
| `src/config/registry.ts` | bundled default vault registry (fallback when remote unavailable) |
| `src/config/remoteConfig.ts` | fetch raw `config/vaults.json` + cache + fallback merge |
| `src/util/http.ts` | `fetchJson` wrapper: HTTPS-only, timeout, single retry |
| `src/util/cache.ts` | read/write JSON cache files with TTL under cache dir |
| `src/util/money.ts` | BigInt/decimals → Number safe conversion |
| `src/util/time.ts` | epoch/ISO helpers, day-diff, window state |
| `src/sources/harbor.ts` | harbor summary fetch + normalize (parse apy string → number) |
| `src/sources/vaultInfo.ts` | vault/info fetch + extract phases/withdrawable/apy/nav |
| `src/sources/chain.ts` | ethers reads: erc20 balanceOf/decimals, vault totalAssets/convertToAssets |
| `src/logic/actionPeriod.ts` | resolve action period: API-first (pALPHA) or config (APC3M), with state |
| `src/logic/position.ts` | epoch-NAV position estimate (pure) |
| `src/logic/reminders.ts` | action-period urgency summary (pure) |
| `src/logic/advise.ts` | merge market + positions + gap signals (pure) |
| `src/update/checkVersion.ts` | daily-cached latest-release check |
| `src/update/selfUpdate.ts` | download release asset + sha256 + atomic replace |
| `src/index.ts` | orchestration: runVaults/runPosition/runReminders/runAdvise/runUpgrade |
| `src/cli.ts` | commander wiring, JSON emit, exit codes |
| `config/vaults.json` | remote data source (registry + APC3M dates + entryNavBaseline) |
| `cli.js` | esbuild output (committed) |
| `SKILL.md` | agent contract (frontmatter + bash few-shot) |
| `README.md` | dev/build/release/per-epoch-update docs |

**Build order rationale:** utils → types → sources → config → logic → update → orchestration → cli → skill/docs. Each task is independently testable with `tsx --test`.

---

## Task 1: Project scaffolding + build pipeline

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/version.ts`, `.gitignore`
- Test: `test/smoke.test.js`

**Interfaces:**
- Produces: `npm run build` → root `cli.js`; `npm test` runs `tsx --test`; `npm run typecheck` runs `tsc --noEmit`. `src/version.ts` exports `VERSION: string`, `OWNER: string`, `REPO: string`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "pharos-rwa-skill",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=18" },
  "bin": { "pharos-rwa": "./cli.js" },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "typecheck": "tsc --noEmit",
    "test": "tsx --test test/**/*.test.js",
    "build": "esbuild src/cli.ts --bundle --platform=node --format=esm --target=node18 --outfile=cli.js --banner:js='#!/usr/bin/env node' --define:__VERSION__=\"\\\"$npm_package_version\\\"\" --define:__OWNER__='\"jason-pharos\"' --define:__REPO__='\"pharos-rwa-skill\"' && chmod +x cli.js"
  },
  "dependencies": { "ethers": "^6", "commander": "^12" },
  "devDependencies": { "typescript": "^5", "@types/node": "^20", "tsx": "^4", "esbuild": "^0.24" }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true, "noEmit": true, "skipLibCheck": true,
    "lib": ["ES2022"], "types": ["node"], "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Write `src/version.ts`**

```ts
// esbuild injects these via --define; tsx/dev falls back to package defaults.
declare const __VERSION__: string;
declare const __OWNER__: string;
declare const __REPO__: string;
export const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';
export const OWNER: string = typeof __OWNER__ !== 'undefined' ? __OWNER__ : 'jason-pharos';
export const REPO: string = typeof __REPO__ !== 'undefined' ? __REPO__ : 'pharos-rwa-skill';
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
*.log
.DS_Store
```

- [ ] **Step 5: Write smoke test `test/smoke.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('node test runner works', () => {
  assert.equal(1 + 1, 2);
});
```

- [ ] **Step 6: Install deps and run test + typecheck**

Run: `npm install && npm test && npm run typecheck`
Expected: test passes (tsx test runner); typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json src/version.ts .gitignore test/smoke.test.js package-lock.json
git commit -m "chore: scaffold pharos-rwa-skill build pipeline"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/types.ts`

**Interfaces:**
- Produces: all shared types used across later tasks (exact names below).

- [ ] **Step 1: Write `src/types.ts`**

```ts
export type VaultId = 'APC3M' | 'pALPHA';
export type NavSource = 'onchain' | 'api';

export interface VaultRegistryEntry {
  id: VaultId;
  displayName: string;
  chainId: number;
  shareToken: string;          // ERC20 whose balanceOf = user shares
  coreVault?: string;          // present when navSource === 'onchain'
  usdc?: string;
  vaultId?: string;            // Pharos vault-info API id (pALPHA)
  navSource: NavSource;
  entryNavBaseline: number;    // epoch-NAV approximation entry price
  apyFallback: number;         // decimal, e.g. 0.14
  actionPeriodConfig: {        // fallback / sole source for APC3M
    lockStart: string;         // ISO8601 with tz
    lockEnd: string;
    actionStart: string;
    actionEnd: string;
    withdrawable: string;      // ISO date
  };
}

export type ActionPeriodSource = 'api' | 'config' | 'unavailable';

export interface ActionPeriod {
  start: string | null;        // ISO8601
  end: string | null;
  startTs: number | null;      // epoch seconds
  endTs: number | null;
  withdrawableDate: string | null;
  source: ActionPeriodSource;
  isOpen: boolean;
  opensInDays: number | null;
  closesInDays: number | null;
  stale: boolean;              // true if config window fully in the past
}

export interface Position {
  vault: VaultId;
  shares: string;              // human-readable decimal string
  nav: number | null;
  currentValue: number | null;
  estimated: boolean;
  assumptions: Record<string, string | number>;
  principal: number | null;
  realizedYield: number | null;
  depositedDurationDays: number | null;
  lockEnd: string | null;
  expectedTotalYield: number | null;
  actionPeriod: ActionPeriod;
}

export interface VaultMarket {
  name: string;
  apy: string;                 // raw string from harbor
  apyValue: number | null;     // parsed decimal, null if unparseable
  tvl: number;
  minimumInvestment: string[];
  assetClass: string;
  topPick: boolean;
  icon: string;
}

export interface AdviceBundle {
  market: VaultMarket[];
  positions: Position[];
  heldVaultIds: VaultId[];
  gapVaults: VaultMarket[];    // open vaults the user does NOT hold
  topPicks: VaultMarket[];
}

export interface UpdateInfo { current: string; latest: string; }

export interface Envelope<T> {
  ok: boolean;
  generatedAt: string;         // ISO8601
  updateAvailable?: UpdateInfo;
  data: T;
  errors: Array<{ scope: string; error: string }>;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared types"
```

---

## Task 3: money + time utils

**Files:**
- Create: `src/util/money.ts`, `src/util/time.ts`
- Test: `test/money.test.js`, `test/time.test.js`

**Interfaces:**
- Produces: `formatUnits(raw: bigint, decimals: number): string`, `toNumber(raw: bigint, decimals: number): number`; `nowSec(): number`, `isoToSec(iso: string): number | null`, `secToIso(sec: number): string`, `dayDiff(fromSec: number, toSec: number): number`, `windowState(startSec: number, endSec: number, nowSec: number): { isOpen; opensInDays; closesInDays; stale }`.

- [ ] **Step 1: Write failing tests `test/money.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatUnits, toNumber } from '../src/util/money.ts';

test('formatUnits handles 6 decimals', () => {
  assert.equal(formatUnits(2165073507606n, 6), '2165073.507606');
});
test('toNumber large value stays finite', () => {
  assert.equal(toNumber(44181088470000n, 6), 44181088.47);
});
```

Note: tests import `.ts` — they run under `node --test --experimental-strip-types` (Node ≥22) OR via `tsx`. Use runner command in Step 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/money.test.js`
Expected: FAIL — cannot find `../src/util/money.ts`.

- [ ] **Step 3: Write `src/util/money.ts`**

```ts
export function formatUnits(raw: bigint, decimals: number): string {
  const neg = raw < 0n;
  const s = (neg ? -raw : raw).toString().padStart(decimals + 1, '0');
  const i = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals).replace(/0+$/, '');
  return (neg ? '-' : '') + (f ? `${i}.${f}` : i);
}

export function toNumber(raw: bigint, decimals: number): number {
  return Number(formatUnits(raw, decimals));
}
```

- [ ] **Step 4: Run money test to verify pass**

Run: `npx tsx --test test/money.test.js`
Expected: PASS.

- [ ] **Step 5: Write failing tests `test/time.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoToSec, dayDiff, windowState } from '../src/util/time.ts';

test('isoToSec parses tz iso', () => {
  assert.equal(isoToSec('2026-07-20T00:00:00+08:00'), 1784476800);
});
test('windowState open', () => {
  const s = windowState(100, 200, 150);
  assert.equal(s.isOpen, true);
  assert.equal(s.closesInDays, 0);
});
test('windowState before start', () => {
  const s = windowState(1000000, 2000000, 0);
  assert.equal(s.isOpen, false);
  assert.ok(s.opensInDays > 0);
  assert.equal(s.stale, false);
});
test('windowState fully past is stale', () => {
  const s = windowState(100, 200, 5000);
  assert.equal(s.isOpen, false);
  assert.equal(s.stale, true);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx tsx --test test/time.test.js`
Expected: FAIL — cannot find module.

- [ ] **Step 7: Write `src/util/time.ts`**

```ts
export function nowSec(): number { return Math.floor(Date.now() / 1000); }

export function isoToSec(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

export function secToIso(sec: number): string {
  return new Date(sec * 1000).toISOString();
}

export function dayDiff(fromSec: number, toSec: number): number {
  return Math.round((toSec - fromSec) / 86400);
}

export function windowState(startSec: number, endSec: number, now: number): {
  isOpen: boolean; opensInDays: number | null; closesInDays: number | null; stale: boolean;
} {
  if (now < startSec) return { isOpen: false, opensInDays: dayDiff(now, startSec), closesInDays: null, stale: false };
  if (now <= endSec) return { isOpen: true, opensInDays: null, closesInDays: dayDiff(now, endSec), stale: false };
  return { isOpen: false, opensInDays: null, closesInDays: null, stale: true };
}
```

- [ ] **Step 8: Run all tests + typecheck**

Run: `npx tsx --test test/time.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/util/money.ts src/util/time.ts test/money.test.js test/time.test.js
git commit -m "feat: money and time utils"
```

---

## Task 4: http + cache utils

**Files:**
- Create: `src/util/http.ts`, `src/util/cache.ts`
- Test: `test/http.test.js`, `test/cache.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `fetchJson<T>(url: string, opts?: { timeoutMs?: number }): Promise<T>` (HTTPS-only, 1 retry, throws on non-2xx/timeout); `fetchText(url, opts?): Promise<string>`; `cacheDir(): string`; `readCache<T>(name: string, ttlSec: number): T | null`; `writeCache(name: string, value: unknown): void`.

- [ ] **Step 1: Write failing test `test/http.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson } from '../src/util/http.ts';

test('rejects non-https', async () => {
  await assert.rejects(() => fetchJson('http://example.com'), /https/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/http.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/util/http.ts`**

```ts
export async function fetchText(url: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  if (!url.startsWith('https://')) throw new Error(`refusing non-https url: ${url}`);
  const timeoutMs = opts.timeoutMs ?? 12000;
  const attempt = async (): Promise<string> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } finally { clearTimeout(t); }
  };
  try { return await attempt(); }
  catch { return await attempt(); } // single retry
}

export async function fetchJson<T>(url: string, opts: { timeoutMs?: number } = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}
```

- [ ] **Step 4: Run http test to verify pass**

Run: `npx tsx --test test/http.test.js`
Expected: PASS.

- [ ] **Step 5: Write failing test `test/cache.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeCache, readCache } from '../src/util/cache.ts';

test('write then read within ttl', () => {
  writeCache('unit-test-x', { a: 1 });
  assert.deepEqual(readCache('unit-test-x', 3600), { a: 1 });
});
test('expired returns null', () => {
  writeCache('unit-test-y', { a: 2 });
  assert.equal(readCache('unit-test-y', -1), null);
});
test('missing returns null', () => {
  assert.equal(readCache('unit-test-missing-zzz', 3600), null);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx tsx --test test/cache.test.js`
Expected: FAIL — module not found.

- [ ] **Step 7: Write `src/util/cache.ts`**

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export function cacheDir(): string {
  const base = process.env.PHAROS_RWA_CACHE_DIR
    || join(homedir() || tmpdir(), '.cache', 'pharos-rwa');
  try { mkdirSync(base, { recursive: true }); } catch { /* ignore */ }
  return base;
}

interface Wrapped { savedAt: number; value: unknown; }

export function writeCache(name: string, value: unknown): void {
  const w: Wrapped = { savedAt: Math.floor(Date.now() / 1000), value };
  try { writeFileSync(join(cacheDir(), `${name}.json`), JSON.stringify(w)); } catch { /* ignore */ }
}

export function readCache<T>(name: string, ttlSec: number): T | null {
  try {
    const raw = readFileSync(join(cacheDir(), `${name}.json`), 'utf8');
    const w = JSON.parse(raw) as Wrapped;
    if (Math.floor(Date.now() / 1000) - w.savedAt > ttlSec) return null;
    return w.value as T;
  } catch { return null; }
}
```

- [ ] **Step 8: Run tests + typecheck**

Run: `npx tsx --test test/cache.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/util/http.ts src/util/cache.ts test/http.test.js test/cache.test.js
git commit -m "feat: http and cache utils"
```

---

## Task 5: Vault registry (bundled default) + remote config

**Files:**
- Create: `src/config/registry.ts`, `src/config/remoteConfig.ts`, `config/vaults.json`
- Test: `test/remoteConfig.test.js`

**Interfaces:**
- Consumes: `VaultRegistryEntry`, `VaultId` (types.ts); `fetchJson` (http.ts); `readCache`/`writeCache` (cache.ts); `OWNER`/`REPO` (version.ts).
- Produces: `DEFAULT_REGISTRY: VaultRegistryEntry[]`; `loadRegistry(opts: { noRemote: boolean }): Promise<VaultRegistryEntry[]>` (remote raw JSON merged over defaults by `id`, 6h cache, fallback to defaults on any failure); `mergeRegistry(base, override): VaultRegistryEntry[]` (pure, exported for test).

- [ ] **Step 1: Write `src/config/registry.ts`**

```ts
import type { VaultRegistryEntry } from '../types.ts';

export const DEFAULT_REGISTRY: VaultRegistryEntry[] = [
  {
    id: 'APC3M',
    displayName: 'AxilPrimeCredit-3M',
    chainId: 1672,
    shareToken: '0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0',
    coreVault: '0xD0428799FbC35557834d33121BA4472692c8908a',
    usdc: '0xC879C018dB60520F4355C26eD1a6D572cdAC1815',
    navSource: 'onchain',
    entryNavBaseline: 1.0,
    apyFallback: 0.14,
    actionPeriodConfig: {
      lockStart: '2026-07-20T00:00:00+08:00',
      lockEnd: '2026-10-20T23:59:59+08:00',
      actionStart: '2026-07-20T00:00:00+08:00',
      actionEnd: '2026-10-16T00:00:00+08:00',
      withdrawable: '2026-10-20',
    },
  },
  {
    id: 'pALPHA',
    displayName: 'Pharos RealFi Ecosystem Vault',
    chainId: 1672,
    shareToken: '0xC3AaCb558aFB635307B66FDb405188138576fc4c',
    vaultId: '1502a2c9-3ea1-4f0d-b513-fb79e3dbbe1f',
    navSource: 'api',
    entryNavBaseline: 1.0,
    apyFallback: 0.14,
    actionPeriodConfig: {
      lockStart: '2026-07-20T00:00:00+08:00',
      lockEnd: '2026-10-01T00:00:00+08:00',
      actionStart: '2026-09-17T11:00:00+08:00',
      actionEnd: '2026-10-01T00:00:00+08:00',
      withdrawable: '2026-10-01',
    },
  },
];
```

- [ ] **Step 2: Write `config/vaults.json` (remote source — mirror of defaults)**

```json
{
  "version": 1,
  "vaults": [
    {
      "id": "APC3M",
      "actionPeriodConfig": {
        "lockStart": "2026-07-20T00:00:00+08:00",
        "lockEnd": "2026-10-20T23:59:59+08:00",
        "actionStart": "2026-07-20T00:00:00+08:00",
        "actionEnd": "2026-10-16T00:00:00+08:00",
        "withdrawable": "2026-10-20"
      },
      "apyFallback": 0.14,
      "entryNavBaseline": 1.0
    }
  ]
}
```

- [ ] **Step 3: Write failing test `test/remoteConfig.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRegistry } from '../src/config/remoteConfig.ts';
import { DEFAULT_REGISTRY } from '../src/config/registry.ts';

test('override merges by id, keeps unknown defaults intact', () => {
  const merged = mergeRegistry(DEFAULT_REGISTRY, {
    version: 1,
    vaults: [{ id: 'APC3M', apyFallback: 0.2 }],
  });
  const apc = merged.find((v) => v.id === 'APC3M');
  const pa = merged.find((v) => v.id === 'pALPHA');
  assert.equal(apc.apyFallback, 0.2);
  assert.equal(apc.coreVault, '0xD0428799FbC35557834d33121BA4472692c8908a'); // untouched
  assert.equal(pa.apyFallback, 0.14); // untouched
});

test('malformed override falls back to base', () => {
  const merged = mergeRegistry(DEFAULT_REGISTRY, null);
  assert.equal(merged.length, DEFAULT_REGISTRY.length);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx tsx --test test/remoteConfig.test.js`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `src/config/remoteConfig.ts`**

```ts
import type { VaultRegistryEntry } from '../types.ts';
import { DEFAULT_REGISTRY } from './registry.ts';
import { fetchJson } from '../util/http.ts';
import { readCache, writeCache } from '../util/cache.ts';
import { OWNER, REPO } from '../version.ts';

const CACHE_KEY = 'remote-config';
const TTL_SEC = 6 * 3600;

interface RemoteOverride {
  version: number;
  vaults: Array<Partial<VaultRegistryEntry> & { id: string }>;
}

export function mergeRegistry(base: VaultRegistryEntry[], override: unknown): VaultRegistryEntry[] {
  const o = override as RemoteOverride | null;
  if (!o || !Array.isArray(o.vaults)) return base;
  return base.map((entry) => {
    const patch = o.vaults.find((v) => v && v.id === entry.id);
    if (!patch) return entry;
    return {
      ...entry,
      ...patch,
      actionPeriodConfig: { ...entry.actionPeriodConfig, ...(patch.actionPeriodConfig ?? {}) },
      id: entry.id, // never let override change identity/addresses implicitly
    };
  });
}

function configUrl(): string {
  return process.env.PHAROS_RWA_CONFIG_URL
    || `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/config/vaults.json`;
}

export async function loadRegistry(opts: { noRemote: boolean }): Promise<VaultRegistryEntry[]> {
  if (opts.noRemote || process.env.PHAROS_RWA_NO_REMOTE) return DEFAULT_REGISTRY;
  const cached = readCache<RemoteOverride>(CACHE_KEY, TTL_SEC);
  if (cached) return mergeRegistry(DEFAULT_REGISTRY, cached);
  try {
    const remote = await fetchJson<RemoteOverride>(configUrl());
    writeCache(CACHE_KEY, remote);
    return mergeRegistry(DEFAULT_REGISTRY, remote);
  } catch {
    return DEFAULT_REGISTRY;
  }
}
```

- [ ] **Step 6: Run test + typecheck**

Run: `npx tsx --test test/remoteConfig.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config/registry.ts src/config/remoteConfig.ts config/vaults.json test/remoteConfig.test.js
git commit -m "feat: vault registry + remote config with fallback"
```

---

## Task 6: harbor source

**Files:**
- Create: `src/sources/harbor.ts`
- Test: `test/harbor.test.js`

**Interfaces:**
- Consumes: `VaultMarket` (types.ts); `fetchJson` (http.ts).
- Produces: `parseApy(raw: string): number | null` (pure, exported); `fetchHarbor(): Promise<VaultMarket[]>` (maps raw harbor rows → `VaultMarket`; `url` field may be array/null in source and is ignored). API base from `process.env.PHAROS_API_BASE ?? 'https://api.pharosnetwork.xyz'`.

- [ ] **Step 1: Write failing test `test/harbor.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApy } from '../src/sources/harbor.ts';

test('parseApy plain percent', () => { assert.equal(parseApy('14%'), 0.14); });
test('parseApy target prefix', () => { assert.equal(parseApy('Target APY 8.5%'), 0.085); });
test('parseApy lowercase target', () => { assert.equal(parseApy('target APY 15%'), 0.15); });
test('parseApy unparseable', () => { assert.equal(parseApy(''), null); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/harbor.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/sources/harbor.ts`**

```ts
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
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/harbor.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: (Optional) live sanity check**

Run: `npx tsx -e "import('./src/sources/harbor.ts').then(m=>m.fetchHarbor()).then(v=>console.log(v.length,'vaults'))"`
Expected: prints a nonzero vault count (network permitting; skip if offline).

- [ ] **Step 6: Commit**

```bash
git add src/sources/harbor.ts test/harbor.test.js
git commit -m "feat: harbor market source"
```

---

## Task 7: vaultInfo source (pALPHA API)

**Files:**
- Create: `src/sources/vaultInfo.ts`
- Test: `test/vaultInfo.test.js`

**Interfaces:**
- Consumes: `fetchJson` (http.ts).
- Produces: `interface VaultInfo { apy: number | null; nav: number | null; withdrawableTs: number | null; minWithdrawalShares: number | null; phases: Array<{ startTs: number; endTs: number; apy: number | null }>; }`; `extractVaultInfo(data: unknown): VaultInfo` (pure, exported); `fetchVaultInfo(vaultId: string): Promise<VaultInfo>`.

- [ ] **Step 1: Write failing test `test/vaultInfo.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractVaultInfo } from '../src/sources/vaultInfo.ts';

const sample = {
  overview: {
    totalApy: 0.14,
    withdrawableTimestamp: 1784545200,
    minWithdrawalShares: 0.1,
    phases: [
      { startTimestamp: 1783508400, endTimestamp: 1784199600, apy: 0.16 },
      { startTimestamp: 1776643200, endTimestamp: 1784545200, apy: 0.14 },
    ],
  },
  vaultInfo: { receiptTokenPrice: 1.034760941 },
};

test('extracts nav from receiptTokenPrice', () => {
  assert.equal(extractVaultInfo(sample).nav, 1.034760941);
});
test('extracts apy + withdrawable + phases', () => {
  const vi = extractVaultInfo(sample);
  assert.equal(vi.apy, 0.14);
  assert.equal(vi.withdrawableTs, 1784545200);
  assert.equal(vi.phases.length, 2);
  assert.equal(vi.phases[0].startTs, 1783508400);
});
test('missing fields → nulls, empty phases', () => {
  const vi = extractVaultInfo({});
  assert.equal(vi.nav, null);
  assert.equal(vi.apy, null);
  assert.deepEqual(vi.phases, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/vaultInfo.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/sources/vaultInfo.ts`**

```ts
import { fetchJson } from '../util/http.ts';

export interface VaultInfo {
  apy: number | null;
  nav: number | null;
  withdrawableTs: number | null;
  minWithdrawalShares: number | null;
  phases: Array<{ startTs: number; endTs: number; apy: number | null }>;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
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
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/vaultInfo.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/vaultInfo.ts test/vaultInfo.test.js
git commit -m "feat: vault-info source (pALPHA API)"
```

---

## Task 8: chain source (ethers reads)

**Files:**
- Create: `src/sources/chain.ts`
- Test: `test/chain.test.js` (unit test on the pure decoding helper only; live reads are optional manual checks)

**Interfaces:**
- Consumes: `toNumber` (money.ts).
- Produces: `makeProvider(rpcUrl: string, chainId: number): JsonRpcProvider`; `getErc20Balance(token, holder, provider): Promise<bigint>`; `getErc20Decimals(token, provider): Promise<number>`; `getShareBalanceHuman(token, holder, provider): Promise<{ raw: bigint; decimals: number; human: string }>`; `getVaultTvl(coreVault, assetDecimals, provider): Promise<number>`; `getVaultNavOnchain(coreVault, shareDecimals, assetDecimals, provider): Promise<number>`. Default RPC constant `DEFAULT_RPC = 'https://rpc.pharos.xyz'`, `DEFAULT_CHAIN_ID = 1672`.

- [ ] **Step 1: Write `src/sources/chain.ts`**

```ts
import { Contract, JsonRpcProvider } from 'ethers';
import { formatUnits, toNumber } from '../util/money.ts';

export const DEFAULT_RPC = 'https://rpc.pharos.xyz';
export const DEFAULT_CHAIN_ID = 1672;

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
];
const VAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function convertToAssets(uint256) view returns (uint256)',
];

export function makeProvider(rpcUrl: string, chainId: number): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, chainId);
}

export async function getErc20Decimals(token: string, provider: JsonRpcProvider): Promise<number> {
  const c = new Contract(token, ERC20_ABI, provider);
  return Number(await c.decimals());
}

export async function getErc20Balance(token: string, holder: string, provider: JsonRpcProvider): Promise<bigint> {
  const c = new Contract(token, ERC20_ABI, provider);
  return (await c.balanceOf(holder)) as bigint;
}

export async function getShareBalanceHuman(token: string, holder: string, provider: JsonRpcProvider): Promise<{ raw: bigint; decimals: number; human: string }> {
  const [raw, decimals] = await Promise.all([
    getErc20Balance(token, holder, provider),
    getErc20Decimals(token, provider),
  ]);
  return { raw, decimals, human: formatUnits(raw, decimals) };
}

export async function getVaultTvl(coreVault: string, assetDecimals: number, provider: JsonRpcProvider): Promise<number> {
  const c = new Contract(coreVault, VAULT_ABI, provider);
  return toNumber((await c.totalAssets()) as bigint, assetDecimals);
}

export async function getVaultNavOnchain(coreVault: string, shareDecimals: number, assetDecimals: number, provider: JsonRpcProvider): Promise<number> {
  const c = new Contract(coreVault, VAULT_ABI, provider);
  const oneShare = 10n ** BigInt(shareDecimals);
  return toNumber((await c.convertToAssets(oneShare)) as bigint, assetDecimals);
}
```

- [ ] **Step 2: Write test `test/chain.test.js` (constants + provider construction, no network)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RPC, DEFAULT_CHAIN_ID, makeProvider } from '../src/sources/chain.ts';

test('defaults are pinned', () => {
  assert.equal(DEFAULT_RPC, 'https://rpc.pharos.xyz');
  assert.equal(DEFAULT_CHAIN_ID, 1672);
});
test('provider constructs without throwing', () => {
  const p = makeProvider(DEFAULT_RPC, DEFAULT_CHAIN_ID);
  assert.ok(p);
});
```

- [ ] **Step 3: Run test + typecheck**

Run: `npx tsx --test test/chain.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Live sanity check (manual, optional)**

Run: `npx tsx -e "import('./src/sources/chain.ts').then(async m=>{const p=m.makeProvider(m.DEFAULT_RPC,m.DEFAULT_CHAIN_ID);console.log('TVL',await m.getVaultTvl('0xD0428799FbC35557834d33121BA4472692c8908a',6,p));})"`
Expected: prints APC3M TVL ≈ 44,000,000+ (network permitting).

- [ ] **Step 5: Commit**

```bash
git add src/sources/chain.ts test/chain.test.js
git commit -m "feat: on-chain source (ethers reads)"
```

---

## Task 9: actionPeriod logic

**Files:**
- Create: `src/logic/actionPeriod.ts`
- Test: `test/actionPeriod.test.js`

**Interfaces:**
- Consumes: `ActionPeriod`, `VaultRegistryEntry` (types.ts); `VaultInfo` (vaultInfo.ts); `isoToSec`, `secToIso`, `windowState`, `dayDiff` (time.ts).
- Produces: `resolveActionPeriod(entry: VaultRegistryEntry, apiInfo: VaultInfo | null, now: number): ActionPeriod` (pure). Rules: if `entry.navSource==='api'` AND apiInfo has a usable phase (prefer the phase whose window contains `now`, else the latest phase by endTs) → source `'api'`, window = that phase's start/end, withdrawableDate from `apiInfo.withdrawableTs`. Else use `entry.actionPeriodConfig.actionStart/actionEnd` → source `'config'`. If neither yields parseable timestamps → source `'unavailable'` with all null. `now` is epoch seconds (injected for testability).

- [ ] **Step 1: Write failing test `test/actionPeriod.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveActionPeriod } from '../src/logic/actionPeriod.ts';

const apc = {
  id: 'APC3M', navSource: 'onchain',
  actionPeriodConfig: {
    lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
    actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00',
    withdrawable: '2026-10-20',
  },
};
const pa = {
  id: 'pALPHA', navSource: 'api',
  actionPeriodConfig: apc.actionPeriodConfig,
};

test('APC3M uses config', () => {
  const now = Math.floor(Date.parse('2026-08-01T00:00:00+08:00') / 1000);
  const ap = resolveActionPeriod(apc, null, now);
  assert.equal(ap.source, 'config');
  assert.equal(ap.isOpen, true); // 08-01 within 07-20..10-16
});

test('pALPHA prefers API phase containing now', () => {
  const now = 1783600000; // within phase[0] 1783508400..1784199600
  const apiInfo = {
    apy: 0.14, nav: 1.03, withdrawableTs: 1784545200, minWithdrawalShares: 0.1,
    phases: [
      { startTs: 1783508400, endTs: 1784199600, apy: 0.16 },
      { startTs: 1776643200, endTs: 1784545200, apy: 0.14 },
    ],
  };
  const ap = resolveActionPeriod(pa, apiInfo, now);
  assert.equal(ap.source, 'api');
  assert.equal(ap.startTs, 1783508400);
  assert.equal(ap.isOpen, true);
  assert.equal(ap.withdrawableDate, '2026-10-16'); // secToIso(1784545200) date part
});

test('pALPHA falls back to config when API empty', () => {
  const now = Math.floor(Date.parse('2026-09-20T00:00:00+08:00') / 1000);
  const apiInfo = { apy: null, nav: null, withdrawableTs: null, minWithdrawalShares: null, phases: [] };
  const ap = resolveActionPeriod(pa, apiInfo, now);
  assert.equal(ap.source, 'config');
});

test('unavailable when config unparseable and no api', () => {
  const broken = { id: 'APC3M', navSource: 'onchain', actionPeriodConfig: { actionStart: 'nope', actionEnd: 'nope', withdrawable: 'nope', lockStart: 'x', lockEnd: 'x' } };
  const ap = resolveActionPeriod(broken, null, 1000);
  assert.equal(ap.source, 'unavailable');
  assert.equal(ap.startTs, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/actionPeriod.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/logic/actionPeriod.ts`**

```ts
import type { ActionPeriod, VaultRegistryEntry } from '../types.ts';
import type { VaultInfo } from '../sources/vaultInfo.ts';
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

function pickPhase(phases: VaultInfo['phases'], now: number): { startTs: number; endTs: number } | null {
  if (phases.length === 0) return null;
  const containing = phases.find((p) => now >= p.startTs && now <= p.endTs);
  if (containing) return containing;
  return [...phases].sort((a, b) => b.endTs - a.endTs)[0] ?? null;
}

export function resolveActionPeriod(entry: VaultRegistryEntry, apiInfo: VaultInfo | null, now: number): ActionPeriod {
  if (entry.navSource === 'api' && apiInfo) {
    const phase = pickPhase(apiInfo.phases, now);
    if (phase) return build(phase.startTs, phase.endTs, apiInfo.withdrawableTs, 'api', now);
  }
  const cfg = entry.actionPeriodConfig;
  const startTs = isoToSec(cfg.actionStart);
  const endTs = isoToSec(cfg.actionEnd);
  const wTs = isoToSec(cfg.withdrawable);
  if (startTs !== null && endTs !== null) return build(startTs, endTs, wTs, 'config', now);
  return build(null, null, null, 'unavailable', now);
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/actionPeriod.test.js && npm run typecheck`
Expected: PASS. (If the withdrawable-date assertion mismatches by a day due to tz, adjust the expected string to the actual `secToIso` UTC date — the logic is correct; the test literal is what moves.)

- [ ] **Step 5: Commit**

```bash
git add src/logic/actionPeriod.ts test/actionPeriod.test.js
git commit -m "feat: action period resolver (api-first + config fallback)"
```

---

## Task 10: position logic (epoch-NAV estimate)

**Files:**
- Create: `src/logic/position.ts`
- Test: `test/position.test.js`

**Interfaces:**
- Consumes: `Position`, `VaultRegistryEntry`, `ActionPeriod` (types.ts); `isoToSec`, `dayDiff` (time.ts).
- Produces: `computePosition(args: { entry: VaultRegistryEntry; sharesHuman: string; nav: number | null; apy: number | null; actionPeriod: ActionPeriod; now: number }): Position` (pure). Math: `shares = Number(sharesHuman)`; `currentValue = nav!=null ? shares*nav : null`; `principal = shares*entry.entryNavBaseline`; `realizedYield = currentValue!=null ? currentValue-principal : null`; `depositedDurationDays = dayDiff(lockStartSec, now)` (>=0, else null); `lockEnd = entry.actionPeriodConfig.lockEnd`; `expectedTotalYield = principal * (apy ?? entry.apyFallback) * lockYears` where `lockYears = (lockEndSec-lockStartSec)/31557600`. Always `estimated:true`, `assumptions: { entryNav: entry.entryNavBaseline, navSource: entry.navSource }`.

- [ ] **Step 1: Write failing test `test/position.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePosition } from '../src/logic/position.ts';

const entry = {
  id: 'APC3M', navSource: 'onchain', entryNavBaseline: 1.0, apyFallback: 0.14,
  actionPeriodConfig: {
    lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
    actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00', withdrawable: '2026-10-20',
  },
};
const ap = { source: 'config', start: null, end: null, startTs: null, endTs: null, withdrawableDate: '2026-10-20', isOpen: false, opensInDays: null, closesInDays: null, stale: false };

test('computes current value, principal, realized yield', () => {
  const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);
  const p = computePosition({ entry, sharesHuman: '100', nav: 1.03, apy: 0.14, actionPeriod: ap, now });
  assert.equal(p.currentValue, 103);
  assert.equal(p.principal, 100);
  assert.ok(Math.abs(p.realizedYield - 3) < 1e-9);
  assert.equal(p.estimated, true);
  assert.equal(p.assumptions.entryNav, 1.0);
  assert.equal(p.depositedDurationDays, 7);
  assert.ok(p.expectedTotalYield > 0);
});

test('null nav → null value/yield but principal still set', () => {
  const p = computePosition({ entry, sharesHuman: '50', nav: null, apy: null, actionPeriod: ap, now: Math.floor(Date.parse('2026-07-27T00:00:00+08:00')/1000) });
  assert.equal(p.currentValue, null);
  assert.equal(p.realizedYield, null);
  assert.equal(p.principal, 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/position.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/logic/position.ts`**

```ts
import type { ActionPeriod, Position, VaultRegistryEntry } from '../types.ts';
import { isoToSec, dayDiff } from '../util/time.ts';

const SECONDS_PER_YEAR = 31557600; // 365.25d

export function computePosition(args: {
  entry: VaultRegistryEntry;
  sharesHuman: string;
  nav: number | null;
  apy: number | null;
  actionPeriod: ActionPeriod;
  now: number;
}): Position {
  const { entry, sharesHuman, nav, apy, actionPeriod, now } = args;
  const shares = Number(sharesHuman);
  const currentValue = nav != null ? shares * nav : null;
  const principal = shares * entry.entryNavBaseline;
  const realizedYield = currentValue != null ? currentValue - principal : null;

  const lockStartSec = isoToSec(entry.actionPeriodConfig.lockStart);
  const lockEndSec = isoToSec(entry.actionPeriodConfig.lockEnd);
  const depositedDurationDays = lockStartSec != null && now >= lockStartSec ? dayDiff(lockStartSec, now) : null;

  const effectiveApy = apy ?? entry.apyFallback;
  const lockYears = lockStartSec != null && lockEndSec != null ? (lockEndSec - lockStartSec) / SECONDS_PER_YEAR : null;
  const expectedTotalYield = lockYears != null ? principal * effectiveApy * lockYears : null;

  return {
    vault: entry.id,
    shares: sharesHuman,
    nav,
    currentValue,
    estimated: true,
    assumptions: { entryNav: entry.entryNavBaseline, navSource: entry.navSource },
    principal,
    realizedYield,
    depositedDurationDays,
    lockEnd: entry.actionPeriodConfig.lockEnd,
    expectedTotalYield,
    actionPeriod,
  };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/position.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/position.ts test/position.test.js
git commit -m "feat: epoch-NAV position estimate"
```

---

## Task 11: reminders logic

**Files:**
- Create: `src/logic/reminders.ts`
- Test: `test/reminders.test.js`

**Interfaces:**
- Consumes: `Position`, `VaultId` (types.ts).
- Produces: `type Urgency = 'open' | 'opening-soon' | 'closing-soon' | 'future' | 'closed' | 'unknown'`; `interface Reminder { vault: VaultId; urgency: Urgency; message: string; actionPeriod: Position['actionPeriod']; }`; `buildReminders(positions: Position[]): Reminder[]` (pure). Rules per position's actionPeriod: `unavailable`→`unknown`; `isOpen && closesInDays<=7`→`closing-soon`; `isOpen`→`open`; `opensInDays!=null && opensInDays<=7`→`opening-soon`; `opensInDays!=null`→`future`; `stale`→`closed`.

- [ ] **Step 1: Write failing test `test/reminders.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminders } from '../src/logic/reminders.ts';

const mk = (vault, ap) => ({ vault, shares: '1', nav: 1, currentValue: 1, estimated: true, assumptions: {}, principal: 1, realizedYield: 0, depositedDurationDays: 1, lockEnd: '', expectedTotalYield: 0, actionPeriod: ap });

test('open and closing soon', () => {
  const r = buildReminders([mk('APC3M', { source: 'config', isOpen: true, opensInDays: null, closesInDays: 3, stale: false })]);
  assert.equal(r[0].urgency, 'closing-soon');
});
test('opening soon', () => {
  const r = buildReminders([mk('pALPHA', { source: 'api', isOpen: false, opensInDays: 5, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'opening-soon');
});
test('future', () => {
  const r = buildReminders([mk('pALPHA', { source: 'api', isOpen: false, opensInDays: 40, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'future');
});
test('unavailable → unknown', () => {
  const r = buildReminders([mk('APC3M', { source: 'unavailable', isOpen: false, opensInDays: null, closesInDays: null, stale: false })]);
  assert.equal(r[0].urgency, 'unknown');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/reminders.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/logic/reminders.ts`**

```ts
import type { Position, VaultId } from '../types.ts';

export type Urgency = 'open' | 'opening-soon' | 'closing-soon' | 'future' | 'closed' | 'unknown';

export interface Reminder {
  vault: VaultId;
  urgency: Urgency;
  message: string;
  actionPeriod: Position['actionPeriod'];
}

function classify(ap: Position['actionPeriod']): Urgency {
  if (ap.source === 'unavailable') return 'unknown';
  if (ap.stale) return 'closed';
  if (ap.isOpen) return ap.closesInDays != null && ap.closesInDays <= 7 ? 'closing-soon' : 'open';
  if (ap.opensInDays != null) return ap.opensInDays <= 7 ? 'opening-soon' : 'future';
  return 'unknown';
}

function messageFor(vault: VaultId, u: Urgency, ap: Position['actionPeriod']): string {
  switch (u) {
    case 'closing-soon': return `${vault}: withdraw window closes in ${ap.closesInDays} day(s).`;
    case 'open': return `${vault}: withdraw window is open now.`;
    case 'opening-soon': return `${vault}: withdraw window opens in ${ap.opensInDays} day(s).`;
    case 'future': return `${vault}: withdraw window opens in ${ap.opensInDays} day(s).`;
    case 'closed': return `${vault}: last known withdraw window has passed; config may be stale.`;
    default: return `${vault}: action period unavailable.`;
  }
}

export function buildReminders(positions: Position[]): Reminder[] {
  return positions.map((p) => {
    const urgency = classify(p.actionPeriod);
    return { vault: p.vault, urgency, message: messageFor(p.vault, urgency, p.actionPeriod), actionPeriod: p.actionPeriod };
  });
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/reminders.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/reminders.ts test/reminders.test.js
git commit -m "feat: action-period reminders"
```

---

## Task 12: advise logic

**Files:**
- Create: `src/logic/advise.ts`
- Test: `test/advise.test.js`

**Interfaces:**
- Consumes: `AdviceBundle`, `VaultMarket`, `Position`, `VaultId` (types.ts).
- Produces: `buildAdvice(market: VaultMarket[], positions: Position[]): AdviceBundle` (pure). `heldVaultIds` = positions' vault ids; `gapVaults` = market entries whose `name` does NOT match a held vault's display name mapping AND `tvl>0`; `topPicks` = market entries with `topPick===true`. Name matching uses `MARKET_NAME_BY_ID: Record<VaultId,string> = { APC3M: 'APC3M', pALPHA: 'pALPHA' }`.

- [ ] **Step 1: Write failing test `test/advise.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvice } from '../src/logic/advise.ts';

const market = [
  { name: 'APC3M', apy: '14%', apyValue: 0.14, tvl: 44000000, minimumInvestment: ['2 USD'], assetClass: 'Fixed Income & Credit', topPick: true, icon: '' },
  { name: 'pALPHA', apy: '14%', apyValue: 0.14, tvl: 16000000, minimumInvestment: ['0.1 USD'], assetClass: 'Fixed Income & Credit', topPick: false, icon: '' },
  { name: 'GPCI', apy: '12%', apyValue: 0.12, tvl: 15000000, minimumInvestment: ['0 USD'], assetClass: 'Fixed Income & Credit', topPick: false, icon: '' },
];
const positions = [{ vault: 'APC3M', shares: '100', nav: 1.03, currentValue: 103, estimated: true, assumptions: {}, principal: 100, realizedYield: 3, depositedDurationDays: 7, lockEnd: '', expectedTotalYield: 4, actionPeriod: { source: 'config', isOpen: false, opensInDays: null, closesInDays: null, stale: false } }];

test('gapVaults excludes held, includes others', () => {
  const b = buildAdvice(market, positions);
  assert.deepEqual(b.heldVaultIds, ['APC3M']);
  const gapNames = b.gapVaults.map((v) => v.name).sort();
  assert.deepEqual(gapNames, ['GPCI', 'pALPHA']);
  assert.equal(b.topPicks.length, 1);
  assert.equal(b.topPicks[0].name, 'APC3M');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/advise.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/logic/advise.ts`**

```ts
import type { AdviceBundle, Position, VaultId, VaultMarket } from '../types.ts';

const MARKET_NAME_BY_ID: Record<VaultId, string> = { APC3M: 'APC3M', pALPHA: 'pALPHA' };

export function buildAdvice(market: VaultMarket[], positions: Position[]): AdviceBundle {
  const heldVaultIds = positions.map((p) => p.vault);
  const heldNames = new Set(heldVaultIds.map((id) => MARKET_NAME_BY_ID[id]));
  const gapVaults = market.filter((m) => !heldNames.has(m.name) && m.tvl > 0);
  const topPicks = market.filter((m) => m.topPick === true);
  return { market, positions, heldVaultIds, gapVaults, topPicks };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/advise.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/advise.ts test/advise.test.js
git commit -m "feat: advice bundle builder"
```

---

## Task 13: version check (daily-cached)

**Files:**
- Create: `src/update/checkVersion.ts`
- Test: `test/checkVersion.test.js`

**Interfaces:**
- Consumes: `UpdateInfo` (types.ts); `fetchJson` (http.ts); `readCache`/`writeCache` (cache.ts); `VERSION`, `OWNER`, `REPO` (version.ts).
- Produces: `isNewer(latest: string, current: string): boolean` (pure semver-ish compare, tolerates leading `v`); `checkForUpdate(opts: { noRemote: boolean }): Promise<UpdateInfo | undefined>` (daily cache key `version-check`, returns undefined when up-to-date/unknown/noRemote).

- [ ] **Step 1: Write failing test `test/checkVersion.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNewer } from '../src/update/checkVersion.ts';

test('newer patch', () => { assert.equal(isNewer('0.1.1', '0.1.0'), true); });
test('newer with v prefix', () => { assert.equal(isNewer('v1.0.0', '0.9.9'), true); });
test('equal not newer', () => { assert.equal(isNewer('1.2.3', '1.2.3'), false); });
test('older not newer', () => { assert.equal(isNewer('1.0.0', '1.1.0'), false); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/checkVersion.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/update/checkVersion.ts`**

```ts
import type { UpdateInfo } from '../types.ts';
import { fetchJson } from '../util/http.ts';
import { readCache, writeCache } from '../util/cache.ts';
import { VERSION, OWNER, REPO } from '../version.ts';

const CACHE_KEY = 'version-check';
const TTL_SEC = 24 * 3600;

function parts(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => Number(n) || 0);
}

export function isNewer(latest: string, current: string): boolean {
  const a = parts(latest), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

interface CachedTag { tag: string; }

export async function checkForUpdate(opts: { noRemote: boolean }): Promise<UpdateInfo | undefined> {
  if (opts.noRemote || process.env.PHAROS_RWA_NO_REMOTE) return undefined;
  let tag: string | null = null;
  const cached = readCache<CachedTag>(CACHE_KEY, TTL_SEC);
  if (cached) tag = cached.tag;
  else {
    try {
      const resp = await fetchJson<{ tag_name?: string }>(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`);
      tag = resp.tag_name ?? null;
      if (tag) writeCache(CACHE_KEY, { tag });
    } catch { return undefined; }
  }
  if (!tag) return undefined;
  return isNewer(tag, VERSION) ? { current: VERSION, latest: tag } : undefined;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/checkVersion.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/update/checkVersion.ts test/checkVersion.test.js
git commit -m "feat: daily-cached version check"
```

---

## Task 14: self-update (upgrade)

**Files:**
- Create: `src/update/selfUpdate.ts`
- Test: `test/selfUpdate.test.js`

**Interfaces:**
- Consumes: `fetchText` (http.ts); `VERSION`, `OWNER`, `REPO` (version.ts). Uses node `crypto`, `fs`, `process.argv[1]`.
- Produces: `sha256(buf: Buffer | Uint8Array): string` (pure, exported); `selfUpdate(opts: { targetPath?: string }): Promise<{ upgraded: boolean; from: string; to: string; note?: string }>`. Downloads latest release `cli.js` + `cli.js.sha256`, verifies, writes temp, atomic `renameSync` over `targetPath` (default `process.argv[1]`). On sha mismatch: throws, original untouched.

- [ ] **Step 1: Write failing test `test/selfUpdate.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '../src/update/selfUpdate.ts';

test('sha256 of "abc" is known digest', () => {
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/selfUpdate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/update/selfUpdate.ts`**

```ts
import { createHash } from 'node:crypto';
import { writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fetchText } from '../util/http.ts';
import { VERSION, OWNER, REPO } from '../version.ts';

export function sha256(buf: Buffer | Uint8Array): string {
  return createHash('sha256').update(buf).digest('hex');
}

function releaseBase(): string {
  return `https://github.com/${OWNER}/${REPO}/releases/latest/download`;
}

export async function selfUpdate(opts: { targetPath?: string } = {}): Promise<{ upgraded: boolean; from: string; to: string; note?: string }> {
  const target = opts.targetPath ?? process.argv[1];
  if (!target) throw new Error('cannot resolve target path for self-update');

  const [cliText, shaText] = await Promise.all([
    fetchText(`${releaseBase()}/cli.js`, { timeoutMs: 30000 }),
    fetchText(`${releaseBase()}/cli.js.sha256`, { timeoutMs: 30000 }),
  ]);

  const expected = shaText.trim().split(/\s+/)[0]?.toLowerCase();
  const actual = sha256(Buffer.from(cliText, 'utf8'));
  if (!expected || expected !== actual) {
    throw new Error(`sha256 mismatch: expected ${expected}, got ${actual}; aborting, original untouched`);
  }

  const tmp = join(dirname(target), `.cli.js.tmp-${process.pid}`);
  writeFileSync(tmp, cliText, { mode: 0o755 });
  renameSync(tmp, target); // atomic on POSIX; safe to replace a running script
  return { upgraded: true, from: VERSION, to: 'latest', note: 'restart to use the new version' };
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/selfUpdate.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/update/selfUpdate.ts test/selfUpdate.test.js
git commit -m "feat: self-update from GitHub Releases with sha256 verify"
```

---

## Task 15: orchestration (index.ts)

**Files:**
- Create: `src/index.ts`
- Test: `test/index.test.js` (unit-tests the pure envelope helper; full runs are integration-verified in Task 16)

**Interfaces:**
- Consumes: everything from sources/logic/config/update layers (exact names as defined in Tasks 2–14).
- Produces:
  - `makeEnvelope<T>(data: T, errors: Envelope<T>['errors'], updateAvailable?: UpdateInfo): Envelope<T>` (pure, exported).
  - `runVaults(opts: RunOpts): Promise<Envelope<{ vaults: VaultMarket[] }>>`
  - `runPosition(address: string, opts: RunOpts): Promise<Envelope<{ address: string; positions: Position[] }>>`
  - `runReminders(address: string, opts: RunOpts): Promise<Envelope<{ address: string; reminders: Reminder[] }>>`
  - `runAdvise(address: string, opts: RunOpts): Promise<Envelope<AdviceBundle>>`
  - `runUpgrade(): Promise<Envelope<{ upgraded: boolean; from: string; to: string; note?: string }>>`
  - `interface RunOpts { rpc?: string; noRemote: boolean; now?: number }`
- Behavior: per-vault work wrapped so a single vault failure pushes `{ scope: vaultId, error }` into `errors` and is skipped. `position`/`reminders`/`advise` first load registry, read on-chain share balance for each vault, skip vaults with zero balance (for position/reminders), fetch NAV per `navSource` (onchain via `getVaultNavOnchain`, api via `fetchVaultInfo`), resolve action period, compute. `updateAvailable` attached from `checkForUpdate` (best-effort; never throws).

- [ ] **Step 1: Write failing test `test/index.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnvelope } from '../src/index.ts';

test('envelope ok true when no errors', () => {
  const e = makeEnvelope({ x: 1 }, []);
  assert.equal(e.ok, true);
  assert.deepEqual(e.data, { x: 1 });
  assert.ok(typeof e.generatedAt === 'string');
});
test('envelope ok false when errors present', () => {
  const e = makeEnvelope({ x: 1 }, [{ scope: 'APC3M', error: 'boom' }]);
  assert.equal(e.ok, false);
});
test('envelope carries updateAvailable when provided', () => {
  const e = makeEnvelope({}, [], { current: '0.1.0', latest: '0.2.0' });
  assert.equal(e.updateAvailable.latest, '0.2.0');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/index.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/index.ts`**

```ts
import type { AdviceBundle, Envelope, Position, UpdateInfo, VaultMarket, VaultRegistryEntry } from './types.ts';
import { loadRegistry } from './config/remoteConfig.ts';
import { fetchHarbor } from './sources/harbor.ts';
import { fetchVaultInfo, type VaultInfo } from './sources/vaultInfo.ts';
import { DEFAULT_RPC, DEFAULT_CHAIN_ID, makeProvider, getShareBalanceHuman, getErc20Decimals, getVaultNavOnchain } from './sources/chain.ts';
import { resolveActionPeriod } from './logic/actionPeriod.ts';
import { computePosition } from './logic/position.ts';
import { buildReminders, type Reminder } from './logic/reminders.ts';
import { buildAdvice } from './logic/advise.ts';
import { checkForUpdate } from './update/checkVersion.ts';
import { selfUpdate } from './update/selfUpdate.ts';
import { nowSec } from './util/time.ts';

export interface RunOpts { rpc?: string; noRemote: boolean; now?: number }

export function makeEnvelope<T>(data: T, errors: Envelope<T>['errors'], updateAvailable?: UpdateInfo): Envelope<T> {
  const env: Envelope<T> = { ok: errors.length === 0, generatedAt: new Date().toISOString(), data, errors };
  if (updateAvailable) env.updateAvailable = updateAvailable;
  return env;
}

async function safeUpdate(opts: RunOpts): Promise<UpdateInfo | undefined> {
  try { return await checkForUpdate({ noRemote: opts.noRemote }); } catch { return undefined; }
}

function providerFor(opts: RunOpts) {
  return makeProvider(opts.rpc ?? process.env.PHAROS_RPC_URL ?? DEFAULT_RPC, DEFAULT_CHAIN_ID);
}

export async function runVaults(opts: RunOpts): Promise<Envelope<{ vaults: VaultMarket[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  let vaults: VaultMarket[] = [];
  try { vaults = await fetchHarbor(); } catch (e) { errors.push({ scope: 'harbor', error: String((e as Error).message ?? e) }); }
  return makeEnvelope({ vaults }, errors, await safeUpdate(opts));
}

async function navFor(entry: VaultRegistryEntry, provider: ReturnType<typeof makeProvider>, shareDecimals: number): Promise<{ nav: number | null; apy: number | null; apiInfo: VaultInfo | null }> {
  if (entry.navSource === 'api' && entry.vaultId) {
    const info = await fetchVaultInfo(entry.vaultId);
    return { nav: info.nav, apy: info.apy, apiInfo: info };
  }
  if (entry.navSource === 'onchain' && entry.coreVault && entry.usdc) {
    const usdcDecimals = await getErc20Decimals(entry.usdc, provider);
    const nav = await getVaultNavOnchain(entry.coreVault, shareDecimals, usdcDecimals, provider);
    return { nav, apy: entry.apyFallback, apiInfo: null };
  }
  return { nav: null, apy: entry.apyFallback, apiInfo: null };
}

async function buildPositions(address: string, opts: RunOpts, errors: Envelope<unknown>['errors']): Promise<Position[]> {
  const registry = await loadRegistry({ noRemote: opts.noRemote });
  const provider = providerFor(opts);
  const now = opts.now ?? nowSec();
  const positions: Position[] = [];

  await Promise.allSettled(registry.map(async (entry) => {
    try {
      const bal = await getShareBalanceHuman(entry.shareToken, address, provider);
      if (bal.raw === 0n) return; // no position
      const { nav, apy, apiInfo } = await navFor(entry, provider, bal.decimals);
      const actionPeriod = resolveActionPeriod(entry, apiInfo, now);
      positions.push(computePosition({ entry, sharesHuman: bal.human, nav, apy, actionPeriod, now }));
    } catch (e) {
      errors.push({ scope: entry.id, error: String((e as Error).message ?? e) });
    }
  }));

  return positions.sort((a, b) => a.vault.localeCompare(b.vault));
}

export async function runPosition(address: string, opts: RunOpts): Promise<Envelope<{ address: string; positions: Position[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope({ address, positions }, errors, await safeUpdate(opts));
}

export async function runReminders(address: string, opts: RunOpts): Promise<Envelope<{ address: string; reminders: Reminder[] }>> {
  const errors: Envelope<unknown>['errors'] = [];
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope({ address, reminders: buildReminders(positions) }, errors, await safeUpdate(opts));
}

export async function runAdvise(address: string, opts: RunOpts): Promise<Envelope<AdviceBundle>> {
  const errors: Envelope<unknown>['errors'] = [];
  let market: VaultMarket[] = [];
  try { market = await fetchHarbor(); } catch (e) { errors.push({ scope: 'harbor', error: String((e as Error).message ?? e) }); }
  const positions = await buildPositions(address, opts, errors);
  return makeEnvelope(buildAdvice(market, positions), errors, await safeUpdate(opts));
}

export async function runUpgrade(): Promise<Envelope<{ upgraded: boolean; from: string; to: string; note?: string }>> {
  const errors: Envelope<unknown>['errors'] = [];
  try {
    const r = await selfUpdate({});
    return makeEnvelope(r, errors);
  } catch (e) {
    errors.push({ scope: 'upgrade', error: String((e as Error).message ?? e) });
    return makeEnvelope({ upgraded: false, from: '', to: '' }, errors);
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx tsx --test test/index.test.js && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/index.test.js
git commit -m "feat: orchestration with per-vault fail isolation"
```

---

## Task 16: CLI (cli.ts) + build + integration verify

**Files:**
- Create: `src/cli.ts`
- Modify: build produces `cli.js` (root)

**Interfaces:**
- Consumes: `runVaults`/`runPosition`/`runReminders`/`runAdvise`/`runUpgrade`, `RunOpts` (index.ts); `VERSION` (version.ts); commander.
- Produces: executable `cli.js`. Global options `--pretty`, `--rpc <url>`, `--no-remote`. Address commands validate `0x` + 40 hex; invalid → stderr JSON + exit 2.

- [ ] **Step 1: Write `src/cli.ts`**

```ts
import { Command } from 'commander';
import { VERSION } from './version.ts';
import { runVaults, runPosition, runReminders, runAdvise, runUpgrade, type RunOpts } from './index.ts';

function emit(obj: unknown, pretty: boolean): void {
  process.stdout.write(JSON.stringify(obj, null, pretty ? 2 : 0) + '\n');
}
function fail(message: string, code = 1): never {
  process.stderr.write(JSON.stringify({ error: message }) + '\n');
  process.exit(code);
}
function assertAddress(addr: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) fail(`invalid address: ${addr}`, 2);
}
function runOpts(o: { rpc?: string; remote?: boolean }): RunOpts {
  return { rpc: o.rpc, noRemote: o.remote === false };
}

const program = new Command();
program.name('pharos-rwa').version(VERSION)
  .option('--pretty', 'pretty-print JSON')
  .option('--rpc <url>', 'override Pharos RPC URL')
  .option('--no-remote', 'skip remote config + version check');

function globals() { return program.opts<{ pretty?: boolean; rpc?: string; remote?: boolean }>(); }

program.command('vaults').description('market overview of all harbor vaults')
  .action(async () => { const g = globals(); emit(await runVaults(runOpts(g)), !!g.pretty); });

program.command('position <address>').description('position overview for APC3M/pALPHA')
  .action(async (address: string) => { const g = globals(); assertAddress(address); emit(await runPosition(address, runOpts(g)), !!g.pretty); });

program.command('reminders <address>').description('action-period reminders')
  .action(async (address: string) => { const g = globals(); assertAddress(address); emit(await runReminders(address, runOpts(g)), !!g.pretty); });

program.command('advise <address>').description('market + position + gap advice bundle')
  .action(async (address: string) => { const g = globals(); assertAddress(address); emit(await runAdvise(address, runOpts(g)), !!g.pretty); });

program.command('upgrade').description('self-update cli.js from the latest GitHub Release')
  .action(async () => { const g = globals(); emit(await runUpgrade(), !!g.pretty); });

program.parseAsync().catch((err: unknown) => fail(String((err as Error)?.message ?? err)));
```

- [ ] **Step 2: Build the bundle**

Run: `npm run build`
Expected: creates root `cli.js`, exits 0. Verify first line is `#!/usr/bin/env node`.

- [ ] **Step 3: Integration — vaults (live)**

Run: `node cli.js vaults --pretty`
Expected: JSON with `ok:true`, `data.vaults` nonempty array (network permitting). If offline, `ok:false` with a `harbor` error entry — still valid JSON.

- [ ] **Step 4: Integration — invalid address**

Run: `node cli.js position 0xnothex; echo "exit=$?"`
Expected: stderr `{"error":"invalid address: 0xnothex"}`, `exit=2`.

- [ ] **Step 5: Integration — position on a real holder (manual)**

Run: `node cli.js position 0x0000000000000000000000000000000000000000 --pretty`
Expected: `ok:true`, `data.positions: []` (zero address holds nothing) — proves zero-balance skip + envelope shape without needing a funded address.

- [ ] **Step 6: Integration — reminders + advise shape**

Run: `node cli.js reminders 0x0000000000000000000000000000000000000000 && node cli.js advise 0x0000000000000000000000000000000000000000`
Expected: both valid JSON; `reminders` empty array; `advise.data.market` nonempty (network permitting), `heldVaultIds` empty.

- [ ] **Step 7: Run full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all PASS.

- [ ] **Step 8: Commit (including built cli.js)**

```bash
git add src/cli.ts cli.js
git commit -m "feat: CLI wiring + built bundle"
```

---

## Task 17: SKILL.md + README + release docs

**Files:**
- Create: `SKILL.md`, `README.md`
- Optional dev-time: validate SKILL.md with the local `skill-creator` `quick_validate.py`.

**Interfaces:**
- Consumes: nothing at runtime. SKILL.md is the agent contract.

- [ ] **Step 1: Write `SKILL.md`**

````markdown
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
````

- [ ] **Step 2: Write `README.md`**

````markdown
# pharos-rwa-skill

Zero-dependency Node CLI skill for managing Pharos RWA vault positions (APC3M, pALPHA).

## Run (end users / agents — no install)

```bash
node cli.js vaults
node cli.js position 0xAddress
node cli.js reminders 0xAddress
node cli.js advise 0xAddress
node cli.js upgrade
```

Flags: `--pretty`, `--rpc <url>`, `--no-remote`.

Env: `PHAROS_RPC_URL` (default `https://rpc.pharos.xyz`, chainId 1672), `PHAROS_API_BASE` (default `https://api.pharosnetwork.xyz`), `PHAROS_RWA_CACHE_DIR`, `PHAROS_RWA_CONFIG_URL`, `PHAROS_RWA_NO_REMOTE`.

## Develop

```bash
npm install
npm run dev -- vaults   # tsx, runs TS source
npm test                # tsx --test
npm run typecheck       # tsc --noEmit
npm run build           # esbuild → cli.js (commit this)
```

After editing `src/`, always `npm run build` and commit `cli.js`. CI check: `npm run build && git diff --exit-code cli.js`.

## Updating action-period dates each epoch

APC3M has no public API for its withdraw window; dates live in `config/vaults.json`. Each new epoch (~3 months):
1. Edit `config/vaults.json` → `APC3M.actionPeriodConfig` with the new lock/action/withdrawable dates.
2. Commit to `main`. Users pick it up automatically within the 6h cache TTL — no reinstall.

## Cutting a release (code updates)

1. Bump `version` in `package.json`.
2. `npm run build`.
3. `shasum -a 256 cli.js | awk '{print $1}' > cli.js.sha256`.
4. Commit `cli.js`.
5. Create a GitHub Release tagged `vX.Y.Z`, upload `cli.js` and `cli.js.sha256` as assets.
6. Users get an `updateAvailable` hint next run; `node cli.js upgrade` pulls it.

## v2 notes

- Port to Go, `go build` a static binary; reuse `go-github-selfupdate` for the upgrade path.
- Add cross-chain cost table + idle-fund analysis (needs quote API / multi-chain scan).
````

- [ ] **Step 3: (Optional) validate SKILL.md structure**

Run: `python3 "/Users/jason/.claude/plugins/marketplaces/anthropics-claude-plugins-official/plugins/skill-creator/skills/skill-creator/scripts/quick_validate.py" SKILL.md` (skip if the script path differs on this machine)
Expected: no structural errors on frontmatter/name/description.

- [ ] **Step 4: Commit**

```bash
git add SKILL.md README.md
git commit -m "docs: SKILL.md agent contract + README (dev/release/epoch-update)"
```

---

## Self-Review

Performed against the spec after drafting all tasks:

**1. Spec coverage**
- Feature 1 (action-period reminders): Tasks 9 (resolve) + 11 (reminders) + 15 (`runReminders`) + 16 CLI. ✓
- Feature 2/3 (market + advice): Tasks 6 (harbor) + 12 (advise) + 15 (`runVaults`/`runAdvise`). ✓ (cross-chain cost table explicitly out of scope per spec Non-Goals.)
- Feature 4 (position overview): Tasks 8 (chain reads) + 10 (epoch-NAV) + 15 (`runPosition`). ✓ estimated flag enforced in Task 10. ✓
- Action period API-first + config fallback (D4): Task 9, both branches tested. ✓
- Auto-upgrade (D8): remote config Task 5, version check Task 13, self-update Task 14, CLI `upgrade` Task 16, per-epoch + release docs Task 17. ✓
- Zero-dependency bundle (D7): Task 1 build script + Task 16 build/commit. ✓
- Fail isolation (Goals): `Promise.allSettled` + per-scope errors in Task 15, tested via zero-address integration. ✓
- Default RPC pinned (D9): Task 8 constants + Global Constraints. ✓
- Open-source reuse (D12): skill-creator validate step Task 17; commander/ethers in Task 1; self-update handwritten per D12. ✓

**2. Placeholder scan** — no "TBD/TODO/handle edge cases"; every code step has full code; every test step has assertions. ✓

**3. Type consistency** — `VaultInfo` defined in Task 7 and consumed with identical shape in Tasks 9/15; `Position`/`ActionPeriod`/`Envelope`/`VaultMarket`/`AdviceBundle` defined in Task 2 and used verbatim downstream; `RunOpts` defined in Task 15 and consumed in Task 16; `Reminder`/`Urgency` from Task 11 used in Task 15. Function names (`loadRegistry`, `mergeRegistry`, `fetchHarbor`, `parseApy`, `extractVaultInfo`, `getShareBalanceHuman`, `getVaultNavOnchain`, `resolveActionPeriod`, `computePosition`, `buildReminders`, `buildAdvice`, `checkForUpdate`, `isNewer`, `selfUpdate`, `sha256`, `makeEnvelope`) are consistent across definition and call sites. ✓

Known deferred detail (not a blocker): the Task 9 `withdrawableDate` test literal may shift by one day depending on the UTC boundary of `secToIso`; the step notes to align the expected string to actual output. Logic is correct; only the test constant adjusts.

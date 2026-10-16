# Vault Epochs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let APC3M and pALPHA carry several operating periods ("epochs") in the registry and report every still-live epoch, so overlapping seasons/phases are both visible to the user.

**Architecture:** A new pure module `src/logic/epochs.ts` resolves `entry.epochs` against `now` into `EpochView[]` (live = `now < withdrawable`, first = `current`, rest = `next`) plus validation errors. Position/APY/lock timing read the `current` epoch instead of the removed `actionPeriodConfig`; positions expose `epochs`; reminders emit one entry per epoch. Remote config no longer touches dates.

**Tech Stack:** TypeScript (ESM, `.ts` import specifiers), Node >= 18, `node:test` via `tsx --test`, esbuild bundle.

**Spec:** `docs/superpowers/specs/2026-10-16-vault-epochs-design.md`

## Global Constraints

- Repo: `/Users/jason/pharos-code/pharos-rwa-skill`, branch `main`. Commit after each task; do NOT push.
- Every commit message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `npm test` (runs `tsx --test test/**/*.test.js`). Single file: `npx tsx --test test/<file>.test.js`. Typecheck: `npm run typecheck`. Both must be clean at the end of every task.
- No new dependencies. Imports use explicit `.ts` extensions like the rest of `src/`.
- All epoch times are full ISO8601 strings with explicit `+08:00` offset (UTC+8). `withdrawable` is a full timestamp, never a bare date.
- Intervals are half-open: an epoch is live while `now < withdrawable`; deposit is open while `deposit.start <= now < deposit.end`; a terms tier is active from its `from` (inclusive) until the next tier's `from`.
- `performanceFeeRate` is the share of the deposit APY (not rewards) taken as fee; `netApy` is after fee.
- Remote config (`config/vaults.json`, `mergeRegistry`) must not override any date/epoch data; only `apyFallback` and `entryNavBaseline`.
- No backward compatibility with old CLI versions is required.

## Review Focus

1. **Exact boundary instants** (`now` equal to `withdrawable`, `deposit.end`, a tier's `from`) — expect half-open behaviour: epoch dropped at `withdrawable`, deposit closed at `deposit.end`, new tier active at its `from`. Pinned in Task 1 (`boundaries are half-open`).
2. **Unsorted `terms` in config** — expect tiers sorted by `from` before picking `currentTerms`. Pinned in Task 1 (`terms are sorted by from`).
3. **Epoch with no `terms`** — expect `currentTerms: null`, `epochApy` falls back to `apyFallback`, and reminders omit the deposit APY suffix instead of crashing. Pinned in Task 1 (`epochApy`) and Task 3 (`deposit suffix omitted without terms`).
4. **A misconfigured epoch must not drop the vault's position** — expect the bad epoch skipped, an `epochs:<id>` error in the envelope, and the position still built. Pinned in Task 2 (`buildPositions` test).
5. **Registry withdrawable written as a bare date or midnight** — `withdrawableDate` is sliced from UTC and would show the previous day; expect every registry epoch time to carry `T…+08:00`. Pinned in Task 2 (registry data test).

---

### Task 1: Epoch types and `epochs.ts` resolver

**Files:**
- Modify: `src/types.ts` (add epoch types; add `epochs?: Epoch[]` to `VaultRegistryEntry`)
- Modify: `src/logic/actionPeriod.ts` (export the window builder as `buildActionPeriod`)
- Create: `src/logic/epochs.ts`
- Test: `test/epochs.test.js`

**Interfaces:**
- Consumes: `isoToSec(iso: string): number | null` from `src/util/time.ts`; `ActionPeriod` type.
- Produces:
  - Types `EpochTerms`, `Epoch`, `EpochRole`, `EpochStatus`, `EpochView` (exported from `src/types.ts`).
  - `buildActionPeriod(startTs: number | null, endTs: number | null, withdrawableTs: number | null, source: ActionPeriod['source'], now: number): ActionPeriod` (exported from `src/logic/actionPeriod.ts`).
  - From `src/logic/epochs.ts`:
    - `interface EpochError { scope: string; error: string }`
    - `resolveEpochs(entry: VaultRegistryEntry, now: number): { epochs: EpochView[]; errors: EpochError[] }`
    - `currentEpoch(entry: VaultRegistryEntry, now: number): EpochView | null`
    - `epochApy(entry: VaultRegistryEntry, now: number): number`
    - `resolveActionPeriod(entry: VaultRegistryEntry, now: number): ActionPeriod`

- [ ] **Step 1: Add the types**

In `src/types.ts`, inside `interface VaultRegistryEntry`, directly after the `depositPeriodConfig?: {...};` member (it is removed in Task 2; leave it for now), add:

```ts
  /**
   * Operating periods of a windowed vault (APC Season N, pALPHA Phase N).
   * Every epoch not yet past `withdrawable` is reported; see logic/epochs.ts.
   */
  epochs?: Epoch[];
```

Then, directly after the closing `}` of `interface VaultRegistryEntry`, add:

```ts
/** APY / fee tier of an epoch; active from `from` until the next tier's `from`. All decimals. */
export interface EpochTerms {
  from: string;                // ISO8601 with tz
  label: string;               // e.g. 'Deposit Period (Pre)'
  grossApy: number;            // e.g. 0.138
  /** Share of the deposit APY (not rewards) taken as performance fee, e.g. 0.1. */
  performanceFeeRate: number;
  netApy: number;              // after performance fee, e.g. 0.125
}

/** One operating period of a windowed vault. All times ISO8601 with tz. */
export interface Epoch {
  id: string;                  // e.g. 'apc-s2'
  label: string;               // e.g. 'Season 2'
  /** Whole deposit window; omitted when unknown. */
  deposit?: { start: string; end: string };
  lockStart: string;
  lockEnd: string;
  actionStart: string;
  actionEnd: string;
  /** Full timestamp; the epoch drops out of the output once it has passed. */
  withdrawable: string;
  terms: EpochTerms[];
}

export type EpochRole = 'current' | 'next';
export type EpochStatus = 'upcoming' | 'deposit-open' | 'locked';

/** An epoch resolved against `now`. */
export interface EpochView {
  id: string;
  label: string;
  /** current = the epoch existing holdings are in; next = newer epochs. */
  role: EpochRole;
  status: EpochStatus;
  deposit: { start: string; end: string; isOpen: boolean } | null;
  lockStart: string;
  lockEnd: string;
  /** This epoch's own withdraw-request window (config dates). */
  actionPeriod: ActionPeriod;
  withdrawable: string;
  /** Tier in effect now; the first tier before the epoch starts; null without tiers. */
  currentTerms: EpochTerms | null;
  /** All tiers, sorted by `from`. */
  terms: EpochTerms[];
}
```

- [ ] **Step 2: Export the window builder**

In `src/logic/actionPeriod.ts`, rename the private `function build(` to `export function buildActionPeriod(` and rename its four call sites (`build(null, null, null, 'unavailable', now)` ×2, `build(startTs, endTs, wTs, 'config', now)`, `build(startTs, endTs, maturityTs, 'r25-api', now)`) to `buildActionPeriod(`. Run `grep -n "build(" src/logic/actionPeriod.ts` afterwards — expected: no output.

- [ ] **Step 3: Write the failing tests**

Create `test/epochs.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEpochs, currentEpoch, epochApy, resolveActionPeriod } from '../src/logic/epochs.ts';

const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

const APC = {
  id: 'APC3M', apyFallback: 0.14,
  epochs: [
    {
      id: 'apc-s1', label: 'Season 1',
      deposit: { start: '2026-07-15T16:00:00+08:00', end: '2026-07-19T23:59:00+08:00' },
      lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
      actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-12T00:00:00+08:00',
      withdrawable: '2026-10-20T23:59:59+08:00',
      terms: [{ from: '2026-07-15T16:00:00+08:00', label: 'Season 1', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
    },
    {
      id: 'apc-s2', label: 'Season 2',
      deposit: { start: '2026-10-13T00:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
      lockStart: '2026-10-20T15:00:00+08:00', lockEnd: '2027-01-21T15:00:00+08:00',
      actionStart: '2026-10-13T00:00:00+08:00', actionEnd: '2027-01-13T00:00:00+08:00',
      withdrawable: '2027-01-21T15:00:00+08:00',
      terms: [
        { from: '2026-10-13T00:00:00+08:00', label: 'Deposit Period (Pre)', grossApy: 0.13, performanceFeeRate: 0, netApy: 0.13 },
        { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period (Extend) & Lock', grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
      ],
    },
  ],
};

const PALPHA = {
  id: 'pALPHA', apyFallback: 0.14,
  epochs: [
    {
      id: 'palpha-p2', label: 'Phase 2',
      lockStart: '2026-07-20T19:00:00+08:00', lockEnd: '2026-10-20T19:00:00+08:00',
      actionStart: '2026-09-17T11:00:00+08:00', actionEnd: '2026-10-01T00:00:00+08:00',
      withdrawable: '2026-10-20T19:00:00+08:00',
      terms: [{ from: '2026-07-20T19:00:00+08:00', label: 'Phase 2', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
    },
    {
      id: 'palpha-p3', label: 'Phase 3',
      deposit: { start: '2026-10-20T15:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
      lockStart: '2026-10-20T15:00:00+08:00', lockEnd: '2027-01-21T15:00:00+08:00',
      actionStart: '2026-12-18T11:00:00+08:00', actionEnd: '2027-01-01T11:00:00+08:00',
      withdrawable: '2027-01-21T15:00:00+08:00',
      terms: [
        { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period', grossApy: 0.138, performanceFeeRate: 0, netApy: 0.138 },
        { from: '2026-10-27T09:00:00+08:00', label: 'Lock Period', grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
      ],
    },
  ],
};

const summary = (entry, iso) =>
  resolveEpochs(entry, sec(iso)).epochs.map((e) => [e.id, e.role, e.status, e.currentTerms?.netApy ?? null]);

test('APC: S1 + S2 overlap on 10-16, only S2 on 10-21, none after S2', () => {
  assert.deepEqual(summary(APC, '2026-10-16T00:00:00+08:00'), [
    ['apc-s1', 'current', 'locked', 0.14],
    ['apc-s2', 'next', 'deposit-open', 0.13],
  ]);
  assert.deepEqual(summary(APC, '2026-10-21T00:00:00+08:00'), [['apc-s2', 'current', 'deposit-open', 0.125]]);
  assert.deepEqual(summary(APC, '2027-02-01T00:00:00+08:00'), []);
});

test('pALPHA: P3 upcoming on 10-16, both live at 10-20 16:00, only P3 after', () => {
  assert.deepEqual(summary(PALPHA, '2026-10-16T00:00:00+08:00'), [
    ['palpha-p2', 'current', 'locked', 0.14],
    ['palpha-p3', 'next', 'upcoming', 0.138],
  ]);
  assert.deepEqual(summary(PALPHA, '2026-10-20T16:00:00+08:00'), [
    ['palpha-p2', 'current', 'locked', 0.14],
    ['palpha-p3', 'next', 'deposit-open', 0.138],
  ]);
  assert.deepEqual(summary(PALPHA, '2026-10-28T00:00:00+08:00'), [['palpha-p3', 'current', 'locked', 0.125]]);
});

test('terms tier switches: APC S2 at 10-20 15:00, pALPHA P3 at 10-27 09:00', () => {
  const s2 = (iso) => resolveEpochs(APC, sec(iso)).epochs.find((e) => e.id === 'apc-s2').currentTerms;
  assert.equal(s2('2026-10-20T14:59:59+08:00').netApy, 0.13);
  assert.equal(s2('2026-10-20T15:00:00+08:00').netApy, 0.125);
  assert.equal(s2('2026-10-20T15:00:00+08:00').performanceFeeRate, 0.1);
  const p3 = (iso) => resolveEpochs(PALPHA, sec(iso)).epochs.find((e) => e.id === 'palpha-p3').currentTerms;
  assert.equal(p3('2026-10-27T08:59:59+08:00').netApy, 0.138);
  assert.equal(p3('2026-10-27T09:00:00+08:00').netApy, 0.125);
});

test('boundaries are half-open', () => {
  // dropped exactly at withdrawable
  assert.deepEqual(summary(PALPHA, '2026-10-20T19:00:00+08:00').map((r) => r[0]), ['palpha-p3']);
  // deposit closed exactly at deposit.end
  const p3 = resolveEpochs(PALPHA, sec('2026-10-27T09:00:00+08:00')).epochs[0];
  assert.equal(p3.status, 'locked');
  assert.equal(p3.deposit.isOpen, false);
  // deposit open exactly at deposit.start
  const p3open = resolveEpochs(PALPHA, sec('2026-10-20T15:00:00+08:00')).epochs.find((e) => e.id === 'palpha-p3');
  assert.equal(p3open.status, 'deposit-open');
  assert.equal(p3open.deposit.isOpen, true);
});

test('view carries dates and a config action period per epoch', () => {
  const [s1, s2] = resolveEpochs(APC, sec('2026-10-16T00:00:00+08:00')).epochs;
  assert.equal(s1.lockEnd, '2026-10-20T23:59:59+08:00');
  assert.equal(s1.deposit.isOpen, false);
  assert.equal(s1.actionPeriod.source, 'config');
  assert.equal(s1.actionPeriod.stale, true); // 10-12 window has passed
  assert.equal(s2.actionPeriod.isOpen, true); // 10-13 .. 2027-01-13
  assert.equal(s2.withdrawable, '2027-01-21T15:00:00+08:00');
  assert.equal(s2.terms.length, 2);
});

test('epoch without deposit: upcoming before lockStart, locked after', () => {
  const entry = { id: 'pALPHA', apyFallback: 0.14, epochs: [PALPHA.epochs[0]] };
  assert.equal(resolveEpochs(entry, sec('2026-07-01T00:00:00+08:00')).epochs[0].status, 'upcoming');
  assert.equal(resolveEpochs(entry, sec('2026-08-01T00:00:00+08:00')).epochs[0].deposit, null);
  assert.equal(resolveEpochs(entry, sec('2026-08-01T00:00:00+08:00')).epochs[0].status, 'locked');
});

test('terms are sorted by from; before the first tier the first tier is reported', () => {
  const e = { ...APC.epochs[1], terms: [...APC.epochs[1].terms].reverse() };
  const entry = { id: 'APC3M', apyFallback: 0.14, epochs: [e] };
  const v = resolveEpochs(entry, sec('2026-10-01T00:00:00+08:00')).epochs[0];
  assert.deepEqual(v.terms.map((t) => t.netApy), [0.13, 0.125]);
  assert.equal(v.status, 'upcoming');
  assert.equal(v.currentTerms.netApy, 0.13);
});

test('invalid epochs are skipped and reported', () => {
  const bad = { ...APC.epochs[1], id: 'bad-date', lockStart: 'nope' };
  const reversed = { ...APC.epochs[1], id: 'reversed', lockEnd: '2026-10-01T00:00:00+08:00' };
  const entry = { id: 'APC3M', apyFallback: 0.14, epochs: [bad, reversed, APC.epochs[1]] };
  const { epochs, errors } = resolveEpochs(entry, sec('2026-10-16T00:00:00+08:00'));
  assert.deepEqual(epochs.map((e) => e.id), ['apc-s2']);
  assert.deepEqual(errors.map((e) => e.scope), ['epochs:bad-date', 'epochs:reversed']);
});

test('no epochs configured → empty, no errors', () => {
  assert.deepEqual(resolveEpochs({ id: 'VRPC-Weekly', apyFallback: 0.1 }, 0), { epochs: [], errors: [] });
});

test('currentEpoch / epochApy / resolveActionPeriod follow the current epoch', () => {
  assert.equal(currentEpoch(APC, sec('2026-10-16T00:00:00+08:00')).id, 'apc-s1');
  assert.equal(epochApy(APC, sec('2026-10-16T00:00:00+08:00')), 0.14);
  assert.equal(epochApy(APC, sec('2026-10-21T00:00:00+08:00')), 0.125);
  assert.equal(epochApy(PALPHA, sec('2026-10-28T00:00:00+08:00')), 0.125);
  // no live epoch / no terms → apyFallback
  assert.equal(epochApy({ ...APC, apyFallback: 0.11 }, sec('2027-02-01T00:00:00+08:00')), 0.11);
  const noTerms = { id: 'APC3M', apyFallback: 0.09, epochs: [{ ...APC.epochs[1], terms: [] }] };
  assert.equal(resolveEpochs(noTerms, sec('2026-10-16T00:00:00+08:00')).epochs[0].currentTerms, null);
  assert.equal(epochApy(noTerms, sec('2026-10-16T00:00:00+08:00')), 0.09);
  // action period
  assert.equal(resolveActionPeriod(APC, sec('2026-10-21T00:00:00+08:00')).end, '2027-01-12T16:00:00.000Z');
  assert.equal(resolveActionPeriod(APC, sec('2027-02-01T00:00:00+08:00')).source, 'unavailable');
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx tsx --test test/epochs.test.js`
Expected: FAIL — cannot find module `../src/logic/epochs.ts`.

- [ ] **Step 5: Implement `src/logic/epochs.ts`**

```ts
import type { ActionPeriod, Epoch, EpochTerms, EpochView, VaultRegistryEntry } from '../types.ts';
import { isoToSec } from '../util/time.ts';
import { buildActionPeriod } from './actionPeriod.ts';

export interface EpochError { scope: string; error: string }

/** Parsed epoch timestamps (seconds). */
interface EpochSecs {
  lockStart: number; lockEnd: number;
  actionStart: number; actionEnd: number;
  withdrawable: number;
  depositStart: number | null; depositEnd: number | null;
}

/** Parse + sanity-check one epoch; returns an error message instead when it is unusable. */
function parseEpoch(e: Epoch): EpochSecs | string {
  const named: Array<[string, string | undefined]> = [
    ['lockStart', e.lockStart], ['lockEnd', e.lockEnd],
    ['actionStart', e.actionStart], ['actionEnd', e.actionEnd],
    ['withdrawable', e.withdrawable],
    ...(e.deposit ? ([['deposit.start', e.deposit.start], ['deposit.end', e.deposit.end]] as Array<[string, string]>) : []),
    ...e.terms.map((t): [string, string] => ['terms.from', t.from]),
  ];
  for (const [name, iso] of named) {
    if (iso == null || isoToSec(iso) == null) return `unparseable ${name}: ${iso}`;
  }
  const s = (iso: string) => isoToSec(iso)!;
  const secs: EpochSecs = {
    lockStart: s(e.lockStart), lockEnd: s(e.lockEnd),
    actionStart: s(e.actionStart), actionEnd: s(e.actionEnd),
    withdrawable: s(e.withdrawable),
    depositStart: e.deposit ? s(e.deposit.start) : null,
    depositEnd: e.deposit ? s(e.deposit.end) : null,
  };
  if (secs.lockEnd <= secs.lockStart) return 'lockEnd must be after lockStart';
  if (secs.actionEnd <= secs.actionStart) return 'actionEnd must be after actionStart';
  if (secs.depositStart != null && secs.depositEnd! <= secs.depositStart) return 'deposit.end must be after deposit.start';
  return secs;
}

function toView(e: Epoch, secs: EpochSecs, role: EpochView['role'], now: number): EpochView {
  const terms: EpochTerms[] = [...e.terms].sort((a, b) => isoToSec(a.from)! - isoToSec(b.from)!);
  let currentTerms: EpochTerms | null = null;
  for (const t of terms) if (isoToSec(t.from)! <= now) currentTerms = t;
  if (currentTerms == null) currentTerms = terms[0] ?? null;

  const depositOpen = secs.depositStart != null && now >= secs.depositStart && now < secs.depositEnd!;
  const opensAt = secs.depositStart ?? secs.lockStart;
  const status: EpochView['status'] = now < opensAt ? 'upcoming' : depositOpen ? 'deposit-open' : 'locked';

  return {
    id: e.id,
    label: e.label,
    role,
    status,
    deposit: e.deposit ? { start: e.deposit.start, end: e.deposit.end, isOpen: depositOpen } : null,
    lockStart: e.lockStart,
    lockEnd: e.lockEnd,
    actionPeriod: buildActionPeriod(secs.actionStart, secs.actionEnd, secs.withdrawable, 'config', now),
    withdrawable: e.withdrawable,
    currentTerms,
    terms,
  };
}

/**
 * Resolve a vault's epochs at `now`: invalid epochs are skipped (and reported),
 * epochs past `withdrawable` drop out (unredeemed holdings roll over into the
 * next epoch), the rest are sorted by lockStart. The first is `current` — the
 * epoch existing holdings are in; later ones are `next`.
 */
export function resolveEpochs(entry: VaultRegistryEntry, now: number): { epochs: EpochView[]; errors: EpochError[] } {
  const errors: EpochError[] = [];
  const live: Array<{ e: Epoch; secs: EpochSecs }> = [];
  for (const e of entry.epochs ?? []) {
    const parsed = parseEpoch(e);
    if (typeof parsed === 'string') {
      errors.push({ scope: `epochs:${e.id}`, error: parsed });
      continue;
    }
    if (now < parsed.withdrawable) live.push({ e, secs: parsed });
  }
  live.sort((a, b) => a.secs.lockStart - b.secs.lockStart);
  return {
    epochs: live.map(({ e, secs }, i) => toView(e, secs, i === 0 ? 'current' : 'next', now)),
    errors,
  };
}

/** The epoch existing holdings are in, or null when no epoch is live. */
export function currentEpoch(entry: VaultRegistryEntry, now: number): EpochView | null {
  return resolveEpochs(entry, now).epochs[0] ?? null;
}

/** Registry APY at `now`: the current epoch's active net APY, else apyFallback. */
export function epochApy(entry: VaultRegistryEntry, now: number): number {
  return currentEpoch(entry, now)?.currentTerms?.netApy ?? entry.apyFallback;
}

/** Config action period of the current epoch; unavailable when no epoch is live. */
export function resolveActionPeriod(entry: VaultRegistryEntry, now: number): ActionPeriod {
  return currentEpoch(entry, now)?.actionPeriod ?? buildActionPeriod(null, null, null, 'unavailable', now);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsx --test test/epochs.test.js` → all PASS.
Run: `npm run typecheck && npm test` → clean, all PASS (nothing else changed behaviour).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/logic/actionPeriod.ts src/logic/epochs.ts test/epochs.test.js
git commit -m "feat(epochs): add epoch types and resolver

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migrate registry, positions and remote config to epochs

**Files:**
- Modify: `src/config/registry.ts` (APC3M, pALPHA → `epochs`; VRPC comments)
- Modify: `src/types.ts` (remove `actionPeriodConfig`, `depositPeriodConfig`, `DepositPhaseTerms`, `DepositPhase`, `DepositPeriod`; `Position.depositPeriod` → `Position.epochs`)
- Modify: `src/config/remoteConfig.ts`, `config/vaults.json`
- Modify: `src/logic/actionPeriod.ts` (delete old `resolveActionPeriod`)
- Modify: `src/logic/position.ts`, `src/logic/position-palpha.ts`, `src/index.ts`
- Test: `test/position.test.js`, `test/position-palpha.test.js`, `test/actionPeriod.test.js`, `test/buildPositions.test.js`, `test/remoteConfig.test.js`

**Interfaces:**
- Consumes (Task 1): `resolveEpochs`, `currentEpoch`, `epochApy`, `resolveActionPeriod` from `src/logic/epochs.ts`; types `Epoch`, `EpochView`.
- Produces: `Position.epochs?: EpochView[]` (present iff the registry entry has `epochs`, possibly `[]`); `VaultRegistryEntry.epochs` populated for APC3M and pALPHA; position `errors` include `epochs:<id>` entries.

- [ ] **Step 1: Update the tests first**

1. `test/position.test.js`:
   - Change the import line to `import { computePosition } from '../src/logic/position.ts';`
   - Replace the `entry` fixture with:
     ```js
     const S1 = {
       id: 'apc-s1', label: 'Season 1',
       lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
       actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00',
       withdrawable: '2026-10-20T23:59:59+08:00',
       terms: [{ from: '2026-07-20T00:00:00+08:00', label: 'Season 1', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
     };
     const entry = { id: 'APC3M', entryNavBaseline: 1.0, apyFallback: 0.14, epochs: [S1] };
     ```
   - Replace the test `'after lock end there is no time left to project — expected == earned'` with:
     ```js
     test('no live epoch (past withdrawable) → no lock data, no projection', () => {
       const now = Math.floor(Date.parse('2026-11-01T00:00:00+08:00') / 1000);
       const p = computePosition({ entry, sharesHuman: '100', nav: 1.03, apy: 0.14, actionPeriod: ap, now });
       assert.equal(p.lockEnd, null);
       assert.equal(p.depositedDurationDays, null);
       assert.equal(p.expectedTotalYield, null);
       assert.deepEqual(p.epochs, []);
     });
     ```
   - Delete the two tests `'resolveDepositPeriod: one window (Pre + Extend), phase per segment'` and `'configApy: Pre net APY before preEnd, Extend net APY after (rest of lock too)'`.
   - Append:
     ```js
     test('overlapping epochs: current drives lock timing, all live epochs attached', () => {
       const S2 = {
         id: 'apc-s2', label: 'Season 2',
         deposit: { start: '2026-10-13T00:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
         lockStart: '2026-10-20T15:00:00+08:00', lockEnd: '2027-01-21T15:00:00+08:00',
         actionStart: '2026-10-13T00:00:00+08:00', actionEnd: '2027-01-13T00:00:00+08:00',
         withdrawable: '2027-01-21T15:00:00+08:00',
         terms: [{ from: '2026-10-13T00:00:00+08:00', label: 'Deposit Period (Pre)', grossApy: 0.13, performanceFeeRate: 0, netApy: 0.13 }],
       };
       const now = Math.floor(Date.parse('2026-10-16T00:00:00+08:00') / 1000);
       const p = computePosition({ entry: { ...entry, epochs: [S2, S1] }, sharesHuman: '100', nav: 1.03, apy: null, actionPeriod: ap, now });
       assert.equal(p.lockEnd, '2026-10-20T23:59:59+08:00');
       assert.deepEqual(p.epochs.map((e) => [e.id, e.role]), [['apc-s1', 'current'], ['apc-s2', 'next']]);
       // apy null → current epoch's net APY (S1: 0.14)
       const yearsLeft = (Date.parse('2026-10-20T23:59:59+08:00') - Date.parse('2026-10-16T00:00:00+08:00')) / 1000 / 31557600;
       assert.ok(Math.abs(p.expectedTotalYield - (3 + 103 * 0.14 * yearsLeft)) < 1e-6);
     });

     test('vault without epochs → no epochs field', () => {
       const now = Math.floor(Date.parse('2026-07-27T00:00:00+08:00') / 1000);
       const p = computePosition({ entry: { id: 'VRPC-Weekly', entryNavBaseline: 1, apyFallback: 0.1 }, sharesHuman: '1', nav: 1, apy: 0.1, actionPeriod: ap, now });
       assert.equal(p.epochs, undefined);
       assert.equal(p.lockEnd, null);
     });
     ```
2. `test/position-palpha.test.js`:
   - Replace the `actionPeriodConfig: {...}` member of `entry` with:
     ```js
     epochs: [{
       id: 'palpha-p2', label: 'Phase 2',
       lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T19:00:00+08:00',
       actionStart: '2026-09-17T11:00:00+08:00', actionEnd: '2026-10-01T00:00:00+08:00',
       withdrawable: '2026-10-20T19:00:00+08:00',
       terms: [{ from: '2026-07-20T00:00:00+08:00', label: 'Phase 2', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
     }],
     ```
   - Replace the test `'after lock end there is no time left to project — expected == earned'` with:
     ```js
     test('no live epoch (past withdrawable) → no lock data, no projection', () => {
       const p = computePAlphaPosition({ ...base, now: Math.floor(Date.parse('2026-11-01T00:00:00+08:00') / 1000) });
       assert.equal(p.lockEnd, null);
       assert.equal(p.expectedTotalYield, null);
       assert.deepEqual(p.epochs, []);
     });
     ```
   - In test `'shares / nav / lock timing stay on-chain + config sourced'` add: `assert.deepEqual(p.epochs.map((e) => e.id), ['palpha-p2']);`
3. `test/actionPeriod.test.js`:
   - Change the first import to `import { resolveRedeemableActionPeriod, resolveR25TrancheActionPeriod } from '../src/logic/actionPeriod.ts';` and add `import { resolveActionPeriod } from '../src/logic/epochs.ts';`
   - Replace the `apc` and `pa` fixtures with:
     ```js
     const epoch = (o) => ({ id: 'e', label: 'E', terms: [], ...o });
     const apc = {
       id: 'APC3M', apyFallback: 0.14,
       epochs: [epoch({
         lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
         actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00',
         withdrawable: '2026-10-20T23:59:59+08:00',
       })],
     };
     // pALPHA uses config for action period, same as APC3M.
     const pa = {
       id: 'pALPHA', apyFallback: 0.14,
       epochs: [epoch({
         lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-01T11:00:00+08:00',
         actionStart: '2026-09-17T11:00:00+08:00', actionEnd: '2026-10-01T00:00:00+08:00',
         withdrawable: '2026-10-01T11:00:00+08:00',
       })],
     };
     ```
   - Replace the `broken` fixture in `'unavailable when config unparseable'` with:
     ```js
     const broken = { id: 'APC3M', apyFallback: 0.14, epochs: [epoch({ actionStart: 'nope', actionEnd: 'nope', withdrawable: 'nope', lockStart: 'x', lockEnd: 'x' })] };
     ```
4. `test/buildPositions.test.js`:
   - In `PALPHA`, replace `actionPeriodConfig: {...}` with:
     ```js
     epochs: [{
       id: 'palpha-p2', label: 'Phase 2',
       lockStart: '2026-07-20T19:00:00+08:00', lockEnd: '2026-10-20T19:00:00+08:00',
       actionStart: '2026-09-17T11:00:00+08:00', actionEnd: '2026-10-01T00:00:00+08:00',
       withdrawable: '2026-10-20T19:00:00+08:00',
       terms: [{ from: '2026-07-20T19:00:00+08:00', label: 'Phase 2', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
     }],
     ```
   - In `APC3M`, replace `actionPeriodConfig: {...}` with:
     ```js
     epochs: [{
       id: 'apc-s1', label: 'Season 1',
       lockStart: '2026-07-20T00:00:00+08:00', lockEnd: '2026-10-20T23:59:59+08:00',
       actionStart: '2026-07-20T00:00:00+08:00', actionEnd: '2026-10-16T00:00:00+08:00',
       withdrawable: '2026-10-20T23:59:59+08:00',
       terms: [{ from: '2026-07-20T00:00:00+08:00', label: 'Season 1', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 }],
     }],
     ```
   - Append (reuses the file's `okDeps`, `ADDR`, `NOW`, `PALPHA`, `APC3M`):
     ```js
     test('a misconfigured epoch is reported but the position is still built', async () => {
       const bad = { ...PALPHA.epochs[0], id: 'bad', lockStart: 'not-a-date' };
       const errors = [];
       const deps = okDeps({ registry: [{ ...PALPHA, epochs: [...PALPHA.epochs, bad] }, APC3M] });
       const positions = await buildPositions(ADDR, { noRemote: true, now: NOW }, errors, deps);
       const pa = positions.find((p) => p.vault === 'pALPHA');
       assert.ok(pa, 'pALPHA position still present');
       assert.deepEqual(pa.epochs.map((e) => e.id), ['palpha-p2']);
       assert.ok(errors.some((e) => e.scope === 'epochs:bad'), JSON.stringify(errors));
     });
     ```
5. `test/remoteConfig.test.js`:
   - In `'registry: both VRPC vaults are redeemability-based with correct lockDays'` change `assert.equal(wk.actionPeriodConfig, undefined); // no fixed dates` to `assert.equal(wk.epochs, undefined); // no fixed dates`.
   - Delete the tests `'APC3M registry matches APC Season 2 windows; depositPeriodConfig overridable'` and `'pALPHA registry matches pAlpha phase 3 windows'`.
   - Append:
     ```js
     test('registry epochs: APC S1/S2 and pALPHA P2/P3 match omni-port-fe', () => {
       const view = (id) => DEFAULT_REGISTRY.find((v) => v.id === id).epochs.map((e) => ({
         id: e.id, deposit: e.deposit ?? null, lock: [e.lockStart, e.lockEnd], action: [e.actionStart, e.actionEnd],
         withdrawable: e.withdrawable, terms: e.terms.map((t) => [t.from, t.grossApy, t.performanceFeeRate, t.netApy]),
       }));
       assert.deepEqual(view('APC3M'), [
         {
           id: 'apc-s1', deposit: { start: '2026-07-15T16:00:00+08:00', end: '2026-07-19T23:59:00+08:00' },
           lock: ['2026-07-20T00:00:00+08:00', '2026-10-20T23:59:59+08:00'],
           action: ['2026-07-20T00:00:00+08:00', '2026-10-12T00:00:00+08:00'],
           withdrawable: '2026-10-20T23:59:59+08:00',
           terms: [['2026-07-15T16:00:00+08:00', 0.14, 0, 0.14]],
         },
         {
           id: 'apc-s2', deposit: { start: '2026-10-13T00:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
           lock: ['2026-10-20T15:00:00+08:00', '2027-01-21T15:00:00+08:00'],
           action: ['2026-10-13T00:00:00+08:00', '2027-01-13T00:00:00+08:00'],
           withdrawable: '2027-01-21T15:00:00+08:00',
           terms: [['2026-10-13T00:00:00+08:00', 0.13, 0, 0.13], ['2026-10-20T15:00:00+08:00', 0.138, 0.1, 0.125]],
         },
       ]);
       assert.deepEqual(view('pALPHA'), [
         {
           id: 'palpha-p2', deposit: null,
           lock: ['2026-07-20T19:00:00+08:00', '2026-10-20T19:00:00+08:00'],
           action: ['2026-09-17T11:00:00+08:00', '2026-10-01T00:00:00+08:00'],
           withdrawable: '2026-10-20T19:00:00+08:00',
           terms: [['2026-07-20T19:00:00+08:00', 0.14, 0, 0.14]],
         },
         {
           id: 'palpha-p3', deposit: { start: '2026-10-20T15:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
           lock: ['2026-10-20T15:00:00+08:00', '2027-01-21T15:00:00+08:00'],
           action: ['2026-12-18T11:00:00+08:00', '2027-01-01T11:00:00+08:00'],
           withdrawable: '2027-01-21T15:00:00+08:00',
           terms: [['2026-10-20T15:00:00+08:00', 0.138, 0, 0.138], ['2026-10-27T09:00:00+08:00', 0.138, 0.1, 0.125]],
         },
       ]);
     });

     test('registry epoch times all carry an explicit +08:00 timestamp', () => {
       for (const v of DEFAULT_REGISTRY) {
         for (const e of v.epochs ?? []) {
           const times = [e.lockStart, e.lockEnd, e.actionStart, e.actionEnd, e.withdrawable,
             ...(e.deposit ? [e.deposit.start, e.deposit.end] : []), ...e.terms.map((t) => t.from)];
           for (const t of times) assert.match(t, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/, `${e.id}: ${t}`);
         }
       }
     });

     test('remote config cannot override epochs', () => {
       const merged = mergeRegistry(DEFAULT_REGISTRY, { version: 1, vaults: [{ id: 'APC3M', epochs: [], apyFallback: 0.2 }] });
       const apc = merged.find((v) => v.id === 'APC3M');
       assert.equal(apc.epochs.length, 2);
       assert.equal(apc.apyFallback, 0.2);
     });
     ```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — e.g. `registry epochs` (registry has no `epochs`), `remote config cannot override epochs`, position tests expecting `p.epochs`.

- [ ] **Step 3: Registry**

In `src/config/registry.ts`, APC3M entry: delete the comment lines `// APC Season 2 (matches …)` / `// Lock starts when …`, the `actionPeriodConfig: {…},` block, the four `// Deposit Period = Pre + Extend …` comment lines and the `depositPeriodConfig: {…},` block. Put in their place:

```ts
    // Operating periods (UTC+8) from omni-port-fe: S1 = apps/port/.env prod
    // values, S2 = APC_SEASON2_DEFAULTS + SEASON2_APY. Every epoch not yet past
    // `withdrawable` is reported (logic/epochs.ts). New season → append an epoch.
    // S2 "Deposit Period (Pre)" / "(Extend)" are two APY/fee tiers of ONE
    // deposit window, hence two `terms` entries rather than two windows.
    epochs: [
      {
        id: 'apc-s1',
        label: 'Season 1',
        deposit: { start: '2026-07-15T16:00:00+08:00', end: '2026-07-19T23:59:00+08:00' },
        lockStart: '2026-07-20T00:00:00+08:00',
        lockEnd: '2026-10-20T23:59:59+08:00',
        actionStart: '2026-07-20T00:00:00+08:00',
        actionEnd: '2026-10-12T00:00:00+08:00',
        withdrawable: '2026-10-20T23:59:59+08:00',
        terms: [
          { from: '2026-07-15T16:00:00+08:00', label: 'Season 1', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 },
        ],
      },
      {
        id: 'apc-s2',
        label: 'Season 2',
        deposit: { start: '2026-10-13T00:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
        lockStart: '2026-10-20T15:00:00+08:00',
        lockEnd: '2027-01-21T15:00:00+08:00',
        actionStart: '2026-10-13T00:00:00+08:00',
        actionEnd: '2027-01-13T00:00:00+08:00',
        withdrawable: '2027-01-21T15:00:00+08:00',
        terms: [
          { from: '2026-10-13T00:00:00+08:00', label: 'Deposit Period (Pre)', grossApy: 0.13, performanceFeeRate: 0, netApy: 0.13 },
          { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period (Extend) & Lock', grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
        ],
      },
    ],
```

pALPHA entry: delete the `// pAlpha phase 3 (matches …)` comment block (4 lines) and the `actionPeriodConfig: {…},` block. Put in their place:

```ts
    // Operating periods (UTC+8). P2 = previous skill config (deposit window
    // unknown); P3 = omni-port-fe PALPHA_PHASE3_WINDOW / PALPHA_PHASE3_APY
    // (performance fee waived while deposits are open). The action period is the
    // withdraw-REQUEST window inside the lock — not the lock end.
    epochs: [
      {
        id: 'palpha-p2',
        label: 'Phase 2',
        lockStart: '2026-07-20T19:00:00+08:00',
        lockEnd: '2026-10-20T19:00:00+08:00',
        actionStart: '2026-09-17T11:00:00+08:00',
        actionEnd: '2026-10-01T00:00:00+08:00',
        withdrawable: '2026-10-20T19:00:00+08:00',
        terms: [
          { from: '2026-07-20T19:00:00+08:00', label: 'Phase 2', grossApy: 0.14, performanceFeeRate: 0, netApy: 0.14 },
        ],
      },
      {
        id: 'palpha-p3',
        label: 'Phase 3',
        deposit: { start: '2026-10-20T15:00:00+08:00', end: '2026-10-27T09:00:00+08:00' },
        lockStart: '2026-10-20T15:00:00+08:00',
        lockEnd: '2027-01-21T15:00:00+08:00',
        actionStart: '2026-12-18T11:00:00+08:00',
        actionEnd: '2027-01-01T11:00:00+08:00',
        withdrawable: '2027-01-21T15:00:00+08:00',
        terms: [
          { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period', grossApy: 0.138, performanceFeeRate: 0, netApy: 0.138 },
          { from: '2026-10-27T09:00:00+08:00', label: 'Lock Period', grossApy: 0.138, performanceFeeRate: 0.1, netApy: 0.125 },
        ],
      },
    ],
```

Change both `// no actionPeriodConfig — see redeemability above.` comments to `// no epochs — see redeemability above.`

- [ ] **Step 4: Types**

In `src/types.ts`:
- Delete the `actionPeriodConfig?: {…};` member and its doc comment, and the `depositPeriodConfig?: {…};` member and its doc comment.
- Delete `interface DepositPhaseTerms`, `type DepositPhase`, `interface DepositPeriod` (with their doc comments).
- In `interface Position`, replace
  ```ts
    /** Present only for vaults with depositPeriodConfig (APC3M). */
    depositPeriod?: DepositPeriod;
  ```
  with
  ```ts
    /** Live epochs (APC3M, pALPHA); present iff the vault is epoch-based. */
    epochs?: EpochView[];
  ```

- [ ] **Step 5: Remote config**

`src/config/remoteConfig.ts`: change the import back to `import type { VaultRegistryEntry } from '../types.ts';` and replace the body of the `base.map` callback after `if (!patch) return entry;` with:

```ts
    // Only policy values can be overridden remotely. Identity/address fields
    // and epoch dates always come from the bundled registry.
    return {
      ...entry,
      apyFallback: patch.apyFallback ?? entry.apyFallback,
      entryNavBaseline: patch.entryNavBaseline ?? entry.entryNavBaseline,
    };
```

(Remove the old comment block, the `merged` variable and both `if (entry.actionPeriodConfig)` / `if (entry.depositPeriodConfig)` blocks.)

Replace `config/vaults.json` with:

```json
{
  "version": 1,
  "vaults": [
    {
      "id": "APC3M",
      "apyFallback": 0.14,
      "entryNavBaseline": 1.0
    }
  ]
}
```

- [ ] **Step 6: actionPeriod.ts**

Delete the old `resolveActionPeriod` function and its doc comment (`Config-based action period (APC3M, pALPHA): …`) from `src/logic/actionPeriod.ts`. If `isoToSec` becomes unused there, remove it from the import.

- [ ] **Step 7: position.ts**

In `src/logic/position.ts`:
- Imports become:
  ```ts
  import type { ActionPeriod, Position, R25HoldingInfo, VaultRegistryEntry } from '../types.ts';
  import { isoToSec, dayDiff } from '../util/time.ts';
  import { currentEpoch, epochApy, resolveEpochs } from './epochs.ts';
  ```
- In `lockTiming`, replace the two `const lockStartSec/lockEndSec` lines with:
  ```ts
    // Lock timing follows the current epoch (the one existing holdings are in).
    const cur = currentEpoch(entry, now);
    const lockStartSec = isoToSec(cur?.lockStart ?? '');
    const lockEndSec = isoToSec(cur?.lockEnd ?? '');
  ```
- Delete `resolveDepositPeriod` and `configApy` (with doc comments).
- `const effectiveApy = apy ?? configApy(entry, now);` → `const effectiveApy = apy ?? epochApy(entry, now);`
- `lockEnd: entry.actionPeriodConfig?.lockEnd ?? null,` → `lockEnd: currentEpoch(entry, now)?.lockEnd ?? null,`
- Replace
  ```ts
    const depositPeriod = resolveDepositPeriod(entry, now);
    if (depositPeriod) position.depositPeriod = depositPeriod;
  ```
  with
  ```ts
    if (entry.epochs) position.epochs = resolveEpochs(entry, now).epochs;
  ```

- [ ] **Step 8: position-palpha.ts**

In `src/logic/position-palpha.ts`:
- Add `import { currentEpoch, epochApy, resolveEpochs } from './epochs.ts';`
- `const effectiveApy = apy ?? entry.apyFallback;` → `const effectiveApy = apy ?? epochApy(entry, now);`
- `lockEnd: entry.actionPeriodConfig?.lockEnd ?? null,` → `lockEnd: currentEpoch(entry, now)?.lockEnd ?? null,`
- Directly before `if (realized != null && unrealized != null && totalYield != null) {` add:
  ```ts
    if (entry.epochs) position.epochs = resolveEpochs(entry, now).epochs;
  ```

- [ ] **Step 9: index.ts**

In `src/index.ts`:
- Line 6 import: drop `resolveActionPeriod, ` (keep the other three names).
- Line 7: `import { computePosition, configApy } from './logic/position.ts';` → `import { computePosition } from './logic/position.ts';`
- Add `import { epochApy, resolveActionPeriod, resolveEpochs } from './logic/epochs.ts';`
- Replace every `configApy(entry, now)` with `epochApy(entry, now)` (3 places).
- In the `navFor` doc comment, replace the lines
  ```
   *  - APY comes from the registry (configApy: current deposit segment's net APY,
   *    else entry.apyFallback), maintained per epoch via
  ```
  with
  ```
   *  - APY comes from the registry (epochApy: the current epoch's active net
   *    APY, else entry.apyFallback), maintained per epoch via
  ```
  and `* Action period comes solely from actionPeriodConfig (see resolveActionPeriod).` with `* Action period comes from the current epoch (see logic/epochs.ts).`
- `if (!entry.r25VaultId || !entry.actionPeriodConfig) continue;` → `if (!entry.r25VaultId || !entry.epochs) continue;`
- In `buildPositions`, as the first statement inside `try {` of `registry.map(async (entry) => {`, add:
  ```ts
        // resolveEpochs skips misconfigured epochs; surface them once per vault.
        for (const err of resolveEpochs(entry, now).errors) errors.push(err);
  ```

- [ ] **Step 10: Verify**

Run: `grep -rn "actionPeriodConfig\|depositPeriod\|configApy\|DepositPhase" src test` → no output.
Run: `npm run typecheck && npm test` → clean, all PASS.

- [ ] **Step 11: Commit**

```bash
git add -A src test config
git commit -m "feat(epochs): migrate APC3M/pALPHA to epochs; positions expose live epochs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Per-epoch reminders

**Files:**
- Modify: `src/logic/reminders.ts`
- Test: `test/reminders.test.js`

**Interfaces:**
- Consumes: `Position.epochs?: EpochView[]` (Task 2), `EpochView` type (Task 1).
- Produces: `Reminder.epoch?: string` (epoch id); `buildReminders(positions)` returns one reminder per live epoch for epoch-based positions, one `unknown` reminder when `epochs` is `[]`, unchanged behaviour when `epochs` is undefined.

- [ ] **Step 1: Write the failing tests**

Append to `test/reminders.test.js`:

```js
const apCfg = (o) => ({ source: 'config', start: null, end: null, startTs: null, endTs: null, withdrawableDate: null, isOpen: false, opensInDays: null, closesInDays: null, stale: false, ...o });
const P3_TERMS = { from: '2026-10-20T15:00:00+08:00', label: 'Deposit Period', grossApy: 0.138, performanceFeeRate: 0, netApy: 0.138 };
const view = (o) => ({
  id: 'palpha-p3', label: 'Phase 3', role: 'next', status: 'deposit-open',
  deposit: { start: '2026-10-20T15:00:00+08:00', end: '2026-10-27T09:00:00+08:00', isOpen: true },
  lockStart: '2026-10-20T15:00:00+08:00', lockEnd: '2027-01-21T15:00:00+08:00',
  actionPeriod: apCfg({ opensInDays: 59 }), withdrawable: '2027-01-21T15:00:00+08:00',
  currentTerms: P3_TERMS, terms: [P3_TERMS], ...o,
});

test('epoch-based position: one reminder per live epoch', () => {
  const current = view({
    id: 'palpha-p2', label: 'Phase 2', role: 'current', status: 'locked', deposit: null,
    withdrawable: '2026-10-20T19:00:00+08:00', actionPeriod: apCfg({ stale: true }),
    currentTerms: null, terms: [],
  });
  const p = { ...mk('pALPHA', apCfg({ stale: true })), epochs: [current, view({})] };
  const r = buildReminders([p]);
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => [x.epoch, x.urgency]), [['palpha-p2', 'closed'], ['palpha-p3', 'future']]);
  assert.match(r[0].message, /^pALPHA Phase 2: withdraw window for this epoch has closed; holdings roll over into the next epoch after Oct 20, 19:00 UTC\+8\.$/);
  assert.match(r[1].message, /^pALPHA Phase 3: withdraw window opens in 59 day\(s\)\. Deposit open until Oct 27, 09:00 UTC\+8 \(Deposit Period net APY 13\.8%\)\.$/);
});

test('current epoch uses the position action period (R25 first), next uses its own', () => {
  const current = view({ id: 'apc-s1', label: 'Season 1', role: 'current', status: 'locked', deposit: null, actionPeriod: apCfg({ stale: true }) });
  const p = { ...mk('APC3M', apCfg({ source: 'r25-api', isOpen: true, closesInDays: 20 })), epochs: [current] };
  const [rem] = buildReminders([p]);
  assert.equal(rem.urgency, 'open');
  assert.equal(rem.actionPeriod.source, 'r25-api');
});

test('deposit suffix omitted without terms', () => {
  const p = { ...mk('pALPHA', apCfg({})), epochs: [view({ role: 'current', currentTerms: null, terms: [] })] };
  const [rem] = buildReminders([p]);
  assert.doesNotMatch(rem.message, /Deposit open/);
});

test('epoch-based position with no live epoch → single unknown reminder', () => {
  const p = { ...mk('APC3M', apCfg({ source: 'unavailable' })), epochs: [] };
  const r = buildReminders([p]);
  assert.equal(r.length, 1);
  assert.equal(r[0].urgency, 'unknown');
  assert.equal(r[0].message, 'APC3M: no active epoch configured; config may be stale.');
  assert.equal(r[0].epoch, undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/reminders.test.js`
Expected: FAIL — only one reminder returned / no `epoch` field.

- [ ] **Step 3: Implement**

In `src/logic/reminders.ts`:
- Import: `import type { EpochView, Position, R25Tranche, VaultId } from '../types.ts';`
- Add `epoch?: string;` to `interface Reminder` after `vault: VaultId;`, with the comment `/** Epoch id (APC3M / pALPHA); absent for non-epoch vaults. */`.
- Change the first parameter of `messageFor` from `vault: VaultId` to `vault: string` (it is only interpolated into text).
- Add after `trancheNote`:

```ts
function pct(n: number): string {
  return `${Number((n * 100).toFixed(2))}%`;
}

/** "Oct 27, 09:00 UTC+8" */
function fmtUtc8(iso: string): string {
  const s = new Date(Date.parse(iso)).toLocaleString('en-US', {
    timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  return `${s} UTC+8`;
}

/**
 * One reminder per live epoch. The current epoch keeps the position's action
 * period (R25 first for APC3M); later epochs use their own config dates.
 */
function epochReminders(p: Position, epochs: EpochView[]): Reminder[] {
  if (epochs.length === 0) {
    return [{ vault: p.vault, urgency: 'unknown', message: `${p.vault}: no active epoch configured; config may be stale.`, actionPeriod: p.actionPeriod }];
  }
  return epochs.map((e) => {
    const ap = e.role === 'current' ? p.actionPeriod : e.actionPeriod;
    const urgency = classify(ap);
    const who = `${p.vault} ${e.label}`;
    let message = urgency === 'closed'
      ? `${who}: withdraw window for this epoch has closed; holdings roll over into the next epoch after ${fmtUtc8(e.withdrawable)}.`
      : messageFor(who, urgency, ap, p.r25?.tranches);
    if (e.deposit?.isOpen && e.currentTerms) {
      message += ` Deposit open until ${fmtUtc8(e.deposit.end)} (${e.currentTerms.label} net APY ${pct(e.currentTerms.netApy)}).`;
    }
    return { vault: p.vault, epoch: e.id, urgency, message, actionPeriod: ap };
  });
}
```

- Replace `buildReminders` with:

```ts
export function buildReminders(positions: Position[]): Reminder[] {
  return positions.flatMap((p) => {
    if (p.epochs) return epochReminders(p, p.epochs);
    const urgency = classify(p.actionPeriod);
    return [{ vault: p.vault, urgency, message: messageFor(p.vault, urgency, p.actionPeriod, p.r25?.tranches), actionPeriod: p.actionPeriod }];
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test test/reminders.test.js` → PASS. If the date regex fails only on formatting (e.g. `Oct 27, 9:00`), fix `fmtUtc8` (not the test) so it prints `Oct 27, 09:00`.
Run: `npm run typecheck && npm test` → clean, all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/logic/reminders.ts test/reminders.test.js
git commit -m "feat(epochs): one reminder per live epoch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Docs, spec note, bundle

**Files:**
- Modify: `skills/pharos-rwa-manager/SKILL.md`, `anvita-flow/pharos-rwa-manager/references/output-interpretation.md`
- Modify: `DEV.md`
- Modify: `docs/superpowers/specs/2026-10-16-vault-epochs-design.md` (record the closed-epoch reminder wording)
- Regenerate: `skills/pharos-rwa-manager/cli.js`, `anvita-flow/pharos-rwa-manager/scripts/cli.js`

**Interfaces:**
- Consumes: final output shape from Tasks 1–3.
- Produces: user-facing docs and the rebuilt CLI bundles.

- [ ] **Step 1: SKILL docs**

In BOTH `skills/pharos-rwa-manager/SKILL.md` and `anvita-flow/pharos-rwa-manager/references/output-interpretation.md`, replace the whole line that starts with ``- `depositPeriod` (APC3M only`` with:

```markdown
- `epochs` (APC3M, pALPHA) — these vaults run in periods (APC Season N, pALPHA Phase N). Every epoch that has not passed its `withdrawable` time is listed, so while a new epoch is open for deposit the previous one is still shown. `role: current` = the epoch existing holdings are in (top-level `actionPeriod` / `lockEnd` / `expectedTotalYield` follow it); `role: next` = the newer epoch that new deposits go into. Holdings not redeemed in the current epoch's action period roll over into the next epoch automatically once its `withdrawable` time passes. `status` is `upcoming` / `deposit-open` / `locked`; `deposit` is the whole deposit window (null when unknown); each epoch's `actionPeriod` is its own withdraw-request window; `currentTerms` is the APY / fee tier in effect now (`netApy` is after the performance fee; `performanceFeeRate` applies to the deposit APY only, not rewards) and `terms` is the full schedule. Always name the epoch when quoting dates or APY and never mix two epochs' figures. APC Season 2's "Deposit Period (Pre)" and "(Extend)" are two APY/fee tiers of ONE deposit window (2026-10-13 00:00 – 2026-10-27 09:00 UTC+8), not two deposit windows. In `reminders`, each live epoch gets its own entry carrying an `epoch` id. An empty `epochs` array means the schedule config is out of date — say the schedule is currently unknown.
```

Run: `grep -n "depositPeriod" skills/pharos-rwa-manager/SKILL.md anvita-flow/pharos-rwa-manager/references/output-interpretation.md` → no output.

- [ ] **Step 2: DEV.md**

- In the source tree listing, after the line `    actionPeriod.ts   — Action period resolution (config, on-chain, R25)` add `    epochs.ts         — Epoch resolution (live epochs, current/next, APY tiers)`.
- In the "Vault Types & Action Period Sources" table, change the APC3M source cell to ``R25 `/vault/period` (current epoch), registry `epochs` fallback`` and the pALPHA source cell to ``Registry `epochs` (config dates)``.
- After that table's following paragraphs (before the next `##`/`###` heading), add:

```markdown
### Epochs (APC3M, pALPHA)

Windowed vaults carry `epochs[]` in `src/config/registry.ts`: deposit window, lock, action period, `withdrawable` (full timestamp) and `terms` (APY / performance-fee tiers, each active from its `from`). `logic/epochs.ts` keeps every epoch with `now < withdrawable`, sorted by `lockStart`; the first is `current` (existing holdings, drives `actionPeriod` / `lockEnd` / APY fallback), the rest are `next`. Misconfigured epochs are skipped and reported as `epochs:<id>` errors.

To launch a new season / phase: append an epoch to the vault's `epochs` (keep the previous one — it drops out by itself after its `withdrawable`), update tests, and release. Remote config cannot override epochs.
```

- [ ] **Step 3: Spec note**

In `docs/superpowers/specs/2026-10-16-vault-epochs-design.md`, in the "reminders" section, after the bullet that starts with `- **日期来源**`, add:

```markdown
- **上一期的赎回窗口已过**：紧急程度仍为 `closed`，但消息改为 `<vault> <label>: withdraw window for this epoch has closed; holdings roll over into the next epoch after <withdrawable>.`，不再沿用"config may be stale"的提示。
```

- [ ] **Step 4: Rebuild bundles and verify**

```bash
npm run typecheck && npm test
npm run build
cp skills/pharos-rwa-manager/cli.js anvita-flow/pharos-rwa-manager/scripts/cli.js
chmod +x anvita-flow/pharos-rwa-manager/scripts/cli.js
grep -c "palpha-p3" skills/pharos-rwa-manager/cli.js
```
Expected: typecheck clean, all tests PASS, grep count ≥ 1.

- [ ] **Step 5: Commit**

```bash
git add -A skills anvita-flow DEV.md docs/superpowers/specs/2026-10-16-vault-epochs-design.md
git commit -m "docs(epochs): document epochs output; rebuild CLI bundles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

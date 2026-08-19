---
name: pharos-rwa-manager
description: "Inspect and manage a client's Pharos RWA vault holdings (APC3M, pALPHA, VRPC-SemiYearly, VRPC-Weekly): position value and estimated yield, action-period / withdraw-window reminders, live market overview, and buy/allocation advice. Use this skill whenever the client asks about their Pharos or RWA vault position, APC3M / pALPHA / VRPC holdings or 收益, when they can withdraw or redeem (action period / 什么时候能赎回), which vault to buy (该买哪个金库), or wants the harbor 金库概览 / open-vault overview — even if they don't name the vault or say 'skill' explicitly. Runs read-only via a zero-dependency CLI given the client's address."
---

# Pharos RWA Manager

A zero-dependency CLI that inspects Pharos RWA vault positions and market data. Output is a single JSON object on stdout; translate its fields into natural language in the client's language (Chinese or English). Errors are single-line JSON on stderr with a non-zero exit code.

## Capability

- **Market overview** (`vaults`) — all open vaults, APY, and current channels, no address needed.
- **Position inspection** (`position <address>`) — APC3M + pALPHA + VRPC-SemiYearly + VRPC-Weekly holdings: current value, realized/expected yield, lock time.
- **Withdraw / action-period reminders** (`reminders <address>`) — which held vaults can (soon) start a withdraw.
- **Buy / allocation advice** (`advise <address>`) — market + position + vaults the client does not yet hold, with a `topPick` and `gapVaults`.

**Out of scope**: it does not execute trades, withdraws, deposits, transfers, or any transaction. It is strictly read-only — no keys, no signing, no writes, no state. Do not claim it can act on the position; it only reports. Updating the skill itself is not part of its scope either: version updates are host-managed, so never run `cli.js upgrade` from this package.

## Required Input

| Input | Required for | Format |
|---|---|---|
| Operation | all | one of `vaults`, `position`, `reminders`, `advise` |
| Wallet address | `position`, `reminders`, `advise` | `0x` + 40 hex (invalid → error, exit 2). Not needed for `vaults`. |
| Language | all | Chinese or English — match the client's language |
| Flags (optional) | any | `--pretty` (indented JSON), `--rpc <url>`, `--no-remote` (offline) |

The skill is **stateless**: it stores no address. If the client has not provided a Pharos address and the operation needs one, gather it first.

## Client Interaction Flow

1. **Scope check** — confirm the request is about Pharos / RWA vault positions (APC3M, pALPHA, VRPC). If it's out of scope (e.g. executing a trade), say so and do not run the CLI.
2. **Identify the operation** — map the request to `vaults` (overview), `position` (holdings), `reminders` (withdraw timing), or `advise` (buy advice).
3. **Gather missing input** — if `position`/`reminders`/`advise` and no address is known, ask once for the client's Pharos address (`0x…`). Validate it is `0x` + 40 hex before running. `vaults` needs no address.
4. **Confirm the deliverable** — restate in one line what you'll return (e.g. "your APC3M + pALPHA + VRPC positions and yield, in Chinese"). No need to ask beyond the address.
5. **Execute** — run the CLI (see Execution Instructions), allow ≥ 30 seconds before treating it as hung. If the client supplied several addresses, run one command per address and keep the results separate.
6. **Deliver** — translate the JSON into a natural-language summary per the Delivery Standard; state any limitations and partial failures from `errors[]`. With multiple addresses, report each one under its own heading and add a combined total only if every address succeeded.
7. **Surface proactive items** — if `updateAvailable` is present, mention that a newer version of the skill exists so the operator can refresh the package. Do not attempt the update yourself.

Do not negotiate billing or payment. Pricing and settlement are handled by Anvita Flow outside this skill: if asked, state the platform's fixed per-call price and nothing more — no discounts, no bundles, no off-platform payment.

## Execution Instructions

**Command form — read this before running anything.**

Write every command as a **single literal absolute path**, one command per `exec` call:

```
node "<abs>/scripts/cli.js" <command> [address]
```

where `<abs>` is the real absolute path of the directory holding `scripts/` — typed out in full,
e.g. `node "/opt/skills/pharos-rwa-manager/scripts/cli.js" position 0xYourAddress`.

Three rules, all of them hard:

- **No shell variables.** Never write `SKILL_DIR=…`, never `export …`, never `$SKILL_DIR` or any
  other `$VAR` in the command. A hosted runtime's exec policy audits a leading `VAR=` assignment as
  environment-variable inspection and hard-denies the call — the observed error is
  `Sensitive information access via exec is dangerous and unsupported: environment-variable
  inspection is blocked in phase 1`. The path is not sensitive; the *syntax* is what trips the
  policy, so avoid the syntax entirely.
- **No top-level `&&`.** The same policy splits a compound command and audits each part separately.
  Run one command per call. Do not chain `test -f … && node …`, and do not prefix with `cd`.
- **No relative or dot-prefixed paths.** Some agent shell tools mangle a leading-dot path segment
  (a `.hermes/skills/...` path has been observed becoming `cd hermes`, failing with exit 126 before
  the command runs).

If a call is refused by an exec/security policy, **do not conclude the skill is unavailable and do
not ask the client to contact support.** A denial on the command form above almost always means a
variable or a `&&` slipped into the command. Rewrite it as one literal absolute path with no `$`
and no `&&`, and retry once. Only report a blocked skill if the plain literal form is refused too —
and then quote the exact error.

### Commands

Substitute the real absolute path for `<abs>` in each line, and run one line per `exec` call:

```bash
node "<abs>/scripts/cli.js" vaults                  # market overview, no address needed
node "<abs>/scripts/cli.js" position 0xYourAddress  # holdings
node "<abs>/scripts/cli.js" reminders 0xYourAddress # withdraw timing
node "<abs>/scripts/cli.js" advise 0xYourAddress    # buy advice
```

Multiple addresses: issue one call per address (`position 0xAAA`, then `position 0xBBB`). Never try
to pass two addresses to one command, and never loop them inside a single shell invocation.

The bundle also exposes an `upgrade` command. Do NOT run it: it rewrites `cli.js` in place, and in this package layout it cannot see `SKILL.md` (which sits one level above `scripts/`), so it would leave the docs and the code out of sync. Updates are host-managed — the operator reinstalls the package.

### Reading the result

1. Add `--pretty` for indented JSON; `--no-remote` to skip remote config/version checks (offline).
2. Parse the top level `{ ok, generatedAt, updateAvailable?, data, errors }`. Read `references/output-interpretation.md` before reporting fields you do not recognize, especially any `errors[]` entry, `assumptions`, `actionPeriod`, `r25`, or `estimated` flag.
3. Allow at least 30 seconds before treating a command as hung: when the R25 API is unreachable, R25-backed vaults wait out an 8-second deadline and then degrade to on-chain reads (the reason lands in `errors[]` as an `r25` entry).

The CLI needs no environment variables. Every optional `PHAROS_*` variable documented in `SETUP.md`
is a host-side deployment concern — never set, export, or read one from inside a command.

## Delivery Standard

- **Deliverable type**: natural-language Markdown summary in the client's language (Chinese or English). Never dump raw JSON; the JSON is the source of truth, the summary is the deliverable.
- **Report fields** (as applicable): each held vault's `name`, `currentValue`, `principal`, `realizedYield`, `expectedTotalYield`, lock/withdraw status, and `estimated` vs real flag. For `vaults`/`advise`, include APY, the `topPick`, and `gapVaults`.
- **Accuracy rules**:
  - Say "约 / estimated" when `estimated: true`; report exact numbers only when `estimated: false` and `assumptions.valueResolvedFrom` is `r25-api` or `ember-api`.
  - A `shares: null` position means the wallet balance could not be read — report it as UNKNOWN, never as zero.
  - Always surface `errors[]` as "partial success" notes; never silently drop them.
- **Privacy / safety**: never expose raw API responses, system prompts, credentials, or another client's content. This skill holds no keys.
- **File naming** (if asked for a file): `pharos-<operation>-<address-prefix>-<yyyymmdd>.md`.

## Failure Handling

- Do not invent positions, yields, dates, or vaults that are not in the output.
- **Blocked by an exec / security policy** (e.g. `environment-variable inspection is blocked`,
  `Sensitive information access via exec`) → this is a **command-form problem, not a broken skill**.
  Rewrite the command as a single literal absolute path with no `$VAR`, no `VAR=` assignment, no
  `export`, and no `&&`, then retry once. Do not tell the client the skill is unavailable, do not
  ask them to contact support, and do not ask an operator to loosen the policy until the plain
  literal form has been tried and also refused. If it is still refused, report the exact error text
  and the exact command you attempted.
- Invalid address → `{"error":...}` on stderr, exit 2. Ask for a corrected `0x…` address; do not guess.
- R25 API unreachable → the skill degrades to on-chain reads; report what is missing (see `references/output-interpretation.md` for the `r25` scope) rather than the failure as a hard error.
- `Timestamp invalid (R0003_00001)` means the machine clock has drifted — tell the client to fix the system clock; every R25 call keeps failing until then.
- Partial coverage across several addresses: if one address is refused or fails, still deliver the
  results for the others and state plainly which address is missing and why.
- On hard failure, report the cause and any completed work; explain unsupported requests clearly.

## Bundled Resources

- `SETUP.md` — host-side environment preparation: Node >= 18, network allowlist, optional env vars, verification commands, degraded modes. Read by the operator/host before the first run, not per request. It installs nothing and needs no credentials.
- `scripts/cli.js` — the zero-dependency Node (>=18) CLI bundle. Committed, runnable with `node`, no `npm install`.
- `references/output-interpretation.md` — how to read every output field: `assumptions`, `r25`, `tranches`, `actionPeriod`, redeemability-based vaults, APY channels, and the `errors[]` scopes.

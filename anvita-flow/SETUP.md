---
name: pharos-rwa-manager-setup
description: Environment preparation for the pharos-rwa-manager Skill package on an Anvita Flow hosted Service Agent. Read once before the first run; no credentials, no package installs, no writes outside a cache directory.
---

# SETUP — pharos-rwa-manager

This document tells the host how to make `scripts/cli.js` runnable. It is **preparation only**:
it installs nothing, needs no credentials, and does not modify the Skill package.

The Skill is strictly read-only (chain + public API reads). It never signs, never holds keys,
and never writes state outside an optional cache directory.

## 1. Requirements

| Item | Requirement | Why |
|---|---|---|
| Node.js | **>= 18** (`node -v`) | `cli.js` uses the built-in global `fetch`. Node 16 and below fail. |
| Package install | **none** | `scripts/cli.js` is a zero-dependency bundle. Do **not** run `npm install`; there is no `package.json`. |
| Runtime tool | **`exec`** | The Skill is invoked as `node "<abs>/scripts/cli.js" <command>` with a literal absolute path (see §4 on command form). In Anvita Flow's Runtime 配置, enable `exec`. `web_search` / `web_fetch` / `browser` / `read` / `write` are not needed — the CLI issues its own HTTPS requests from Node. |
| Outbound network | HTTPS to the hosts in §3 | Without it the Skill degrades or fails; see §6. |
| System clock | accurate (NTP-synced, drift < ~30s) | The R25 API rejects skewed requests with `Timestamp invalid (R0003_00001)`. |
| Credentials / keys | **none** | No API key, no private key, no wallet, no env secret. If any setup step asks for a key, something is wrong — stop. |

## 2. Environment variables (all optional)

Nothing is required. Set these only to override defaults:

| Variable | Default | Purpose |
|---|---|---|
| `PHAROS_RPC_URL` | `https://rpc.pharos.xyz` | Alternate Pharos RPC endpoint. Also settable per call via `--rpc <url>`. |
| `PHAROS_API_BASE` | `https://api.pharosnetwork.xyz` | Alternate Pharos public API base. |
| `PHAROS_RWA_CONFIG_URL` | `https://raw.githubusercontent.com/jason-pharos/pharos-rwa-skill/main/config/vaults.json` | Alternate remote vault registry. Mirror this if `raw.githubusercontent.com` is not reachable. |
| `PHAROS_RWA_CACHE_DIR` | `$HOME/.cache/pharos-rwa` (falls back to the temp dir) | Cache location. Set it to a writable path (e.g. `/tmp/pharos-rwa`) if `$HOME` is read-only. |
| `PHAROS_RWA_NO_REMOTE` | unset | Any truthy value forces offline mode, same as the `--no-remote` flag. |
| `DEBUG` | unset | Verbose diagnostics on stderr. Leave unset in production — output is noisy, not client-facing. |

## 3. Network allowlist

Outbound HTTPS (443) to:

- `rpc.pharos.xyz` — on-chain reads (required; without it nothing works)
- `app.r25.xyz` — R25 vault NAV / earnings API (optional; falls back to on-chain reads)
- `api.pharosnetwork.xyz` — Pharos public API for market data (optional; degrades)
- `raw.githubusercontent.com` — remote vault registry + version check (optional; the bundled registry is used instead)

No inbound ports. No websockets. No other hosts are contacted. Icon URLs under
`static.pharosnetwork.xyz` appear in the JSON output as strings but are never fetched by the CLI.

## 4. Setup steps

> ⚠️ **Command form on a hosted runtime.** The snippets below are written for an *operator* at a
> shell, where variables and `&&` are fine. A hosted Service Agent's `exec` policy is stricter: it
> audits a leading `VAR=` assignment as environment-variable inspection and hard-denies the call
> (observed: `Sensitive information access via exec is dangerous and unsupported:
> environment-variable inspection is blocked in phase 1`), and it splits a top-level `&&` and audits
> each part. So on a hosted runtime, run one command per call using a **single literal absolute
> path** — no `$VAR`, no `VAR=`, no `export`, no `&&`. `SKILL.md` documents only that form, which is
> what the Agent follows at runtime.

Operator shell (replace the path with the real one):

```bash
# 1) Verify the layout — one command per line, no chaining needed
ls -l /absolute/path/to/pharos-rwa-manager/SKILL.md
ls -l /absolute/path/to/pharos-rwa-manager/scripts/cli.js

# 2) Verify the runtime
node -v            # must print v18 or newer

# 3) Only if $HOME is read-only: redirect the cache (deployment-level env, not per command)
mkdir -p /tmp/pharos-rwa
# then set PHAROS_RWA_CACHE_DIR=/tmp/pharos-rwa in the runtime's environment configuration
```

Always invoke by a full literal absolute path. Do **not** `cd` into the package with a relative
dot-prefixed path — some agent shell tools mangle a leading-dot path segment
(a `.hermes/skills/...` path has been observed becoming `cd hermes`, failing with
exit 126 before the command runs).

## 5. Verification

Run both checks, one per call. Expect a single-line JSON object on stdout and exit code 0.

```bash
# Offline path — proves the bundle and Node runtime are fine, no network involved
node "/absolute/path/to/pharos-rwa-manager/scripts/cli.js" vaults --no-remote

# Online path — proves the network allowlist is correct
node "/absolute/path/to/pharos-rwa-manager/scripts/cli.js" vaults
```

Pass criteria:

- exit code `0`
- stdout parses as JSON with `"ok": true`
- `data.vaults` is a non-empty array
- `errors` is empty, or contains only entries you accept per §6

Address-scoped commands need no extra setup; a well-formed address is enough:

```bash
node "/absolute/path/to/pharos-rwa-manager/scripts/cli.js" position 0x0000000000000000000000000000000000000000
```

An invalid address is expected to print single-line JSON on **stderr** and exit `2`.
That is correct behaviour, not a setup failure.

## 6. Degraded modes (not failures)

| Condition | Behaviour | Host action |
|---|---|---|
| `app.r25.xyz` unreachable / slow | R25-backed vaults wait out an 8s deadline, then fall back to on-chain reads; an `r25` entry lands in `errors[]` | none — allow >= 30s per call before treating it as hung |
| `raw.githubusercontent.com` blocked | Bundled vault registry is used; no version check | none, or mirror it via `PHAROS_RWA_CONFIG_URL` |
| `api.pharosnetwork.xyz` blocked | Market fields degrade; reported in `errors[]` | open the host if full market data is wanted |
| Fully offline | Use `--no-remote`; on-chain reads still need `rpc.pharos.xyz` | open at least the RPC host |
| `Timestamp invalid (R0003_00001)` | Every R25 call keeps failing | fix the system clock (NTP) — retrying will not help |

## 7. Updates — do not self-update

The bundle exposes an `upgrade` command. **Never run it.** It rewrites `cli.js` in place and,
in this layout, cannot see `SKILL.md` one level above `scripts/`, so it would leave the docs and
the code out of sync.

Updates are host-managed: re-upload the whole Skill package (a new ZIP) through the Anvita Flow
console. If a run reports `updateAvailable`, surface it to the operator and stop there.

## 8. Suggested Runtime 配置

| Setting | Suggestion | Reason |
|---|---|---|
| 單次最長執行時間 | 5–10 minutes | A call is normally 2–10s; the ceiling only covers R25 deadline + retries. |
| 最大併發會話數 | 2–3 | The CLI is stateless with no shared lock, so concurrent calls are safe; each is a short-lived Node process. |
| 單次任務 AI Credit 上限 | small | One call is a single CLI invocation plus a short summary — no long agent loops. |
| Runtime 工具 | only `exec` | Required. `web_search` / `web_fetch` / `browser` / `read` / `write` are not needed. At least one tool must be enabled or the form rejects it. |
| 收款錢包 | must be selected | Step 1's 資源與測試幣收款 is validated (`請選擇收款錢包`). |

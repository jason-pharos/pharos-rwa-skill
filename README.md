# pharos-rwa-skill

Zero-dependency Node CLI skill for managing Pharos RWA vault positions (APC3M, pALPHA).
Portable across AI agents — `SKILL.md` + `cli.js`, no runtime deps, read-only.

## Install / 安装

This skill is agent-agnostic: it is a `SKILL.md` instruction file plus a single
zero-dependency `cli.js`. Any AI agent that can read a markdown file and run a
shell command can use it — Claude Code, OpenClaw, Hermes agents, Cursor,
OpenAI/Codex-style agents, LangChain/LlamaIndex tools, or your own harness.

Requirements: Node.js >= 18. No `npm install` — `cli.js` is a committed bundle.

### Quick install (recommended)

Use [`npx skills`](https://github.com/vercel-labs/skills), the open agent-skills
installer. It supports Claude Code, OpenCode, Codex, Cursor and ~30 other agents,
and installs the whole skill directory (`SKILL.md` + `cli.js`), not just the
markdown:

```bash
npx skills add jason-pharos/pharos-rwa-skill
```

It auto-detects the agents you have installed. Useful variants:

```bash
npx skills add jason-pharos/pharos-rwa-skill --list        # show what's in the repo
npx skills add jason-pharos/pharos-rwa-skill -g            # install for all projects
npx skills add jason-pharos/pharos-rwa-skill -a claude-code -a opencode
npx skills add jason-pharos/pharos-rwa-skill -y            # non-interactive / CI
npx skills update                                          # update installed skills
```

The skill lands in your agent's skills directory (e.g.
`.claude/skills/pharos-rwa-manager/` or `.agents/skills/…`) with `cli.js` next to
`SKILL.md`, so it is runnable immediately.

### Manual install

If your agent isn't covered by `npx skills`, just clone the repo — the skill is a
plain directory:

```bash
git clone https://github.com/jason-pharos/pharos-rwa-skill.git
```

Clone it anywhere the agent can reach. If your agent has a conventional skills
directory, clone straight into it, e.g.:

| Agent | Skills directory |
|---|---|
| Claude Code (personal) | `~/.claude/skills/pharos-rwa-manager` |
| Claude Code (project) | `<repo>/.claude/skills/pharos-rwa-manager` |
| OpenClaw / Hermes-style agents | whatever directory your agent scans for skills (often `~/.<agent>/skills/` or a `skills/` folder in the agent's workdir) |
| Anything else | any path; point the agent at it explicitly (see below) |

The directory must keep `SKILL.md` at its top level — that file is the contract:
its front matter holds the name, description, and trigger conditions, and its
body documents every command and output field.

### Wiring it into an agent

Auto-discovery covers most agents (and `npx skills` wires it up for you). For
anything else, pick whichever fits your harness:

- **Skill-directory convention** — agents that auto-discover skills (Claude Code
  and similar) pick it up after a restart / new session. Invoke by name, e.g.
  `/pharos-rwa-manager`, or just ask about your Pharos / RWA position and the
  description in `SKILL.md` triggers it.
- **Load `SKILL.md` into the system prompt** — for agents without a skills
  mechanism, concatenate `SKILL.md` into the system prompt or context and let the
  model shell out to `cli.js`. This is the lowest-common-denominator path and
  works everywhere.
- **Wrap the CLI as a tool** — register each subcommand
  (`vaults`, `position`, `reminders`, `advise`) as a function/tool that runs
  `node /path/to/cli.js <subcommand> [address]` and returns stdout. Output is a
  single JSON object, so it drops straight into a tool result. Use `SKILL.md` as
  the tool description.
- **MCP / plugin hosts** — expose the same `node cli.js …` invocation as a tool
  in your MCP server; no wrapper logic needed beyond passing arguments through.

Contract for any integration: stdout is one JSON object, stderr is one-line JSON
on error, exit code is non-zero on failure. It is read-only — no keys, no signing,
no writes — so it is safe to run unattended.

### Verify

```bash
node /path/to/pharos-rwa-skill/cli.js vaults --pretty
```

### Update

```bash
npx skills update                                   # if installed via npx skills
cd /path/to/pharos-rwa-skill && git pull            # if cloned manually
```

Or let the CLI self-update `cli.js` from the newest GitHub Release:

```bash
node cli.js upgrade
```

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

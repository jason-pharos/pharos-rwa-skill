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

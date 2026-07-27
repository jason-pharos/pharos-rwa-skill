# Pharos RWA Skill — 设计文档

> 状态：待实现 · 日期：2026-07-27 · 仓库：`jason-pharos/pharos-rwa-skill`

## Context

为 Pharos Port 的 RWA 金库用户提供一个 **AI agent skill**，帮助管理已投资的 RWA 资产。

**受众**：使用 openclaw / hermes 等 agent 的用户；提醒经由 Telegram 等 IM 工具送达（由上层 agent 负责，见运行模型）。

**v1 支持的金库**：仅 `APC3M`（Axil Prime Credit 3M，Pharos 主网 CoreVault，ERC4626 风格）与 `pALPHA`（Pharos RealFi Ecosystem Vault，Ember/Bluefin 基础设施）。后续 Pharos Port 计划在 harbor 页展示用户投资总览，届时再扩展到全部金库。

**要解决的四类功能**：
1. **Action period 提醒**：每日收集用户已投资金库的 action period（可发起 withdraw 的窗口），提示用户。
2. **市场分析 + 建议**：每日收集最新金库信息，结合用户持仓，产出投资建议（是否值得买入新金库）。建议文本由上层 agent 的 LLM 生成，skill 只提供结构化数据。
3. **按需查询开放金库 + 建议**：用户主动询问时给出。
4. **持仓总览**：APC3M / pALPHA 的余额、已存时长、已实现收益、当前锁仓到期、预期总收益、action period。

**实现语言**：v1 用 JavaScript/TypeScript 实验；功能稳定后改用 Go 编译出可执行文件（v2）。本 spec 只覆盖 v1。

### 关键调研结论（决定架构的硬事实）

在 `pharos-omni-port-fe` 与 `pre-deposit-page-fe` 两个现有前端 + 实测公开 API/RPC 得出：

- **份额余额**：链上 ERC20 `balanceOf(addr)` + `decimals()`（参考 `useApcVaultData.ts:94`、`use-token-balances.ts:83`）。
- **APC3M 链上读数**：`totalAssets()` = TVL，`convertToAssets(1 share)` = NAV/份额单价（参考 `services/contracts/vault.ts`）。合约地址（主网）：core `0xD0428799FbC35557834d33121BA4472692c8908a`、share `0xEC47E6f3EF1E7bc8e00F670aC3d5016798Fe44d0`、usdc `0xC879C018dB60520F4355C26eD1a6D572cdAC1815`。
- **harbor summary API**（公开、无需 JWT）：`GET https://api.pharosnetwork.xyz/omni_port/harbor/summary` → 全部金库的 name/apy/tvl/minimumInvestment/assetClass/topPick。是市场概览数据源。
- **vault-info API**（公开、无需 JWT）：`GET https://api.pharosnetwork.xyz/omni_port/vault/info?vaultId=<id>` → 实测 pALPHA（vaultId `1502a2c9-3ea1-4f0d-b513-fb79e3dbbe1f`）返回 `overview.totalApy`、`overview.minWithdrawalShares`、`overview.withdrawableTimestamp`、`overview.phases[].{startTimestamp,endTimestamp,apy}`、`apyDetail.*`。可作为 pALPHA 的 action period / 锁仓 / APY 动态源。
- **APC3M 无对应 vault-info API**：其 action period / deposit window / lock period 全部在前端 `.env` hardcode（`VITE_APC_*`，见 `apcContent.ts`），链上和公开 API 都拿不到。当期（prod）值：deposit `2026-07-15`→`2026-07-19`、lock `2026-07-20`→`2026-10-20`、action period `2026-07-20`→`2026-10-16`、withdrawable `2026-10-20`。每期（约 3 个月）变化。
- **交易/入金历史需要 JWT**（`services/api/apc/api.ts` 注释："records/deposit/aml 需 JWT"）。与"纯 CLI 无 JWT"方向冲突。
- **链上事件日志扫描不可行**：实测 Pharos 主网出块 ≈ 0.06s（**约 144 万块/天**），当前高度 1350 万；ZAN RPC `eth_getLogs` 单次上限 **1000 块**。一个 4 天存款窗口 ≈ 576 万块 ≈ **5764 次请求**，CLI 无法承受。
- **无公开索引 API**：pharosscan.xyz 是自研前端，未发现 Etherscan/Blockscout 兼容的公开索引接口。

→ 因此**持仓的"已存多久/已实现收益"改用 epoch-NAV 近似**（见 D5），不依赖历史查询、不需 JWT。

## Goals / Non-Goals

**Goals**
- 零依赖 CLI（只需 Node ≥18，连 npm install 都不要求运行），输出合法 JSON 到 stdout。
- 五个子命令：`vaults` / `position` / `reminders` / `advise` / `upgrade`。
- 数据源、计算逻辑、CLI 三层清晰隔离；计算层纯函数，便于 v2 移植 Go。
- 失败隔离：单个数据源/单个金库失败不影响其他输出。
- 自动升级（方案 A + GitHub）：数据层远程配置自动拉取 + 缓存 + 内置回退；代码层经 GitHub Releases 主动自更新 + 每日"有新版本"提示。

**Non-Goals（v1 不做）**
- 不做调度与 Telegram 发送——由上层 agent 负责（skill 是被动 CLI）。
- 不做跨链成本/收益示例表（100/1000/10000 USDC 磨损）——推到 v2。
- 不分析用户跨链闲置资金（多链资产扫描）——推到 v2。
- 不自动扩展到全部金库——v1 仅 APC3M + pALPHA。
- 不使用 JWT / 后端 records API；不做精确入金历史（用 epoch-NAV 近似替代）。
- 不静默替换代码；代码升级必须由用户/agent 显式触发 `upgrade`。
- 不实现 Go 版本（v2）。

## Decisions

### D1 — 运行模型：纯 CLI，agent 编排

skill 只是零依赖 CLI：输入地址、输出 JSON（持仓/action period/市场/建议输入）。**每日定时调度与 Telegram 发送由上层 agent（openclaw/hermes）负责**。与参考 skill（RWA Collateral Health Monitor）一致，最简单、最契合 agent skill 生态。

### D2 — 模块分层与目录结构

```
pharos-rwa-skill/
├── SKILL.md                  # frontmatter(触发词/metadata) + bash few-shot 示例（agent 契约）
├── cli.js                    # esbuild 产物（提交 git）；GitHub Release 也发布同一文件作为资产
├── cli.js.sha256             # 构建产物校验和（发布到 Release，供 upgrade 校验）
├── version.json              # { version }（可选：主分支也放一份，供无 Release 时降级检查）
├── config/
│   └── vaults.json           # 【远程数据源】金库注册表 + APC3M action period 当期日期
├── src/
│   ├── cli.ts                # commander 子命令；纯 JSON→stdout，错误→stderr
│   ├── index.ts              # 编排：runVaults/runPosition/runReminders/runAdvise/runUpgrade
│   ├── version.ts            # 编译期注入的 VERSION 常量 + 源仓库常量（OWNER/REPO）
│   ├── config/
│   │   ├── registry.ts       # 内置默认金库注册表（远程拉不到时的回退）
│   │   └── remoteConfig.ts   # 拉 raw config/vaults.json + 本地缓存 + 回退
│   ├── sources/
│   │   ├── harbor.ts         # GET /omni_port/harbor/summary
│   │   ├── vaultInfo.ts      # GET /omni_port/vault/info?vaultId=
│   │   └── chain.ts          # ethers: balanceOf/decimals/totalAssets/convertToAssets
│   ├── logic/
│   │   ├── actionPeriod.ts   # API 优先 + config 兜底，解析 action period/锁仓/可赎回
│   │   ├── position.ts       # epoch-NAV 近似算持仓
│   │   ├── reminders.ts      # action period 紧迫度
│   │   └── advise.ts         # 市场 + 持仓 + 缺口信号 合并成建议输入包
│   ├── update/
│   │   ├── checkVersion.ts   # 每日缓存的版本检查（GitHub Releases API）
│   │   └── selfUpdate.ts     # upgrade：下载 release 资产 + sha256 校验 + 原子替换
│   ├── util/
│   │   ├── cache.ts          # 本地 JSON 缓存（远程配置、版本检查结果）
│   │   ├── http.ts           # fetch 封装（超时、HTTPS-only、单次重试）
│   │   └── money.ts          # BigInt/decimals 安全换算
│   └── types.ts
├── package.json              # scripts: dev(tsx)/build(esbuild)/typecheck
├── tsconfig.json
└── README.md
```

**为什么 cli 和 index 拆开**：`index.ts` 只"算"（输入参数、返回对象、不打印不退出），`cli.ts` 只"接 shell"（解析 argv、stringify、exit code）。单测可直接 import index，v2 移植也以 index 为准。

**为什么源码 `src/` 而产物 `cli.js` 在根**：SKILL.md few-shot 指向产物 `cli.js`；开发者改 `src/*.ts` 后 `npm run build` 打包。产物在根、源码在子目录，避免 agent 误读 `.ts`。

参考 D1（分层）+ 参考 skill 的 sources×logic×cli 切法。

### D3 — CLI 子命令（commander.js）

| 命令 | 功能映射 | 参数 | 数据源 |
|---|---|---|---|
| `vaults` | 功能 2/3 市场概览 | 无 | harbor API |
| `position <address>` | 功能 4 持仓总览 | 地址 | 链上 + vaultInfo/config |
| `reminders <address>` | 功能 1 action period 提醒 | 地址 | 链上余额 + actionPeriod |
| `advise <address>` | 功能 2/3 建议输入包 | 地址 | vaults + position + 缺口信号 |
| `upgrade` | 代码自更新 | 无 | GitHub Releases |

- 通用选项：`--pretty`（美化）、`--rpc <url>`（覆盖 RPC，等价 env `PHAROS_RPC_URL`）、`--no-remote`（跳过远程配置/版本检查，纯内置默认，便于离线/测试）。
- stdout 始终是合法 JSON（agent 恒可 `JSON.parse`）；错误走 stderr 的单行 JSON `{ "error": "..." }` + 非零 exit code。
- `--pretty` 只影响缩进，不影响结构。

### D4 — 数据源与 action period 解析

- **harbor.ts**：`GET /omni_port/harbor/summary`，直接透传每个金库的 name/icon/apy/tvl/minimumInvestment/assetClass/topPick（apy 是字符串如 `"14%"`/`"Target APY 8.5%"`，透传原文 + 尽力解析出数值 `apyValue`）。
- **vaultInfo.ts**：`GET /omni_port/vault/info?vaultId=<id>`，抽取 `overview.totalApy`、`overview.withdrawableTimestamp`、`overview.phases[]`、`overview.minWithdrawalShares`。
- **chain.ts**：ethers v6 `JsonRpcProvider(rpcUrl, chainId)`；`balanceOf`/`decimals`（ERC20）、`totalAssets`/`convertToAssets`（CoreVault，参考 `vault.ts`）。
- **actionPeriod.ts**（API 优先 + config 兜底）：
  - pALPHA：优先用 vault-info API 的 phases/withdrawableTimestamp 推导 action period 窗口；失败回退 config。
  - APC3M：无对应 API → 直接用 `config/vaults.json` 的 `actionPeriod`（当期日期）。
  - 两者都拿不到 → 该字段标 `unavailable`，不阻塞其他输出。
  - 输出统一形状：`{ start, end, withdrawableDate, source: "api"|"config"|"unavailable", isOpen, opensInDays|closesInDays }`（时间用 ISO8601 + epoch 秒双写）。

### D5 — 持仓估算：epoch-NAV 近似

APC3M/pALPHA 均为 epoch（固定期）金库，同期入金集中在存款窗口、入场 NAV 基本相同（新一期 ≈ 1.0）。据此无需任何历史查询：

- 当前价值 `currentValue = shares × convertToAssets(1 share)`（链上，标的 USDC 单位）
- 入场 NAV `entryNav`：优先取该期存款窗口的 NAV（若 API 能给历史起始 NAV，否则取 1.0），来自 `config/vaults.json` 的 `entryNavBaseline`
- 本金 `principal ≈ shares × entryNav`
- 已实现收益 `realizedYield ≈ currentValue − principal`
- 已存时长 `duration = now − lockStart`（来自 actionPeriod/config）
- 预期总收益 `expectedTotalYield = principal × apy × lockDurationYears`（lock 全期）；`expectedRemainingYield` 同理按剩余锁仓期

**所有近似字段在输出里标 `estimated: true`**，并附 `assumptions`（如 `entryNav=1.0`）说明口径，避免 agent 把近似值当精确值转述。

**风险与缓解**：用户若在一期中途以不同 NAV 入场，principal/realizedYield 会有偏差 → 用 `estimated` + `assumptions` 明示；v2 若引入可选 JWT 或索引源再精确化。

### D6 — SKILL.md 契约（agent 入口）

frontmatter 必须完整（参考 Pharos 已有 skill）：

```yaml
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
```

body 用 bash few-shot 示例驱动（LLM 在范例上比纯 schema 更准）：`node cli.js vaults`、`node cli.js position 0x...`、`node cli.js reminders 0x...` 等，说明输出是单个 JSON 对象，agent 把字段翻译成自然语言（含中英文，遵循用户语言）。few-shot 只用 `node cli.js ...`（绝对零依赖路径）。

### D7 — 构建与提交产物

- esbuild 单文件 bundle：`esbuild src/cli.ts --bundle --platform=node --format=esm --target=node18 --outfile=cli.js --banner:js='#!/usr/bin/env node'`，构建后 `chmod +x cli.js`。
- VERSION 与 OWNER/REPO 通过 esbuild `--define` 注入 `version.ts`。
- 依赖：`ethers@^6`、`commander@^12`（都 tree-shake 内联进 bundle）。dev：typescript/tsx/esbuild/@types/node。
- 提交 `cli.js` 到 git；同时作为 GitHub Release 资产发布（含 `cli.js.sha256`）。
- tsc 仅做 `--noEmit` 类型检查，产物完全交给 esbuild。
- CI/约定：`npm run build` 后 `git diff --exit-code cli.js`，防止改了 src 忘记 rebuild。

### D8 — 自动升级（方案 A + GitHub 托管）

源仓库钉死进 bundle：`OWNER=jason-pharos`、`REPO=pharos-rwa-skill`（仅 env 可覆盖用于开发，不接受任意用户输入，防指向恶意源）。

**数据层（自动、高频）** — `remoteConfig.ts`：
- 运行时 `fetch https://raw.githubusercontent.com/jason-pharos/pharos-rwa-skill/main/config/vaults.json`。
- 本地缓存（TTL 默认 6h，落 `~/.cache/pharos-rwa/` 或 `os.tmpdir()`）。
- 拉取失败或超时 → 回退 bundle 内置 `config/registry.ts` 默认值。
- 用途：金库注册表（地址/vaultId/链/decimals）+ APC3M `actionPeriod` 当期日期 + `entryNavBaseline`。**在 GitHub 改一次，用户下次运行自动生效，无需重装**。用 `main` 分支即取最新，正是为了数据即时生效。

**代码层（主动、低频）**：
- 版本检查 `checkVersion.ts`：`GET https://api.github.com/repos/jason-pharos/pharos-rwa-skill/releases/latest` → `tag_name`，比对内嵌 `VERSION`。**每日缓存一次**（规避未鉴权 GitHub API 60次/小时限制）。较旧时在每个命令的 JSON 输出加 `updateAvailable: { current, latest }`，agent 可转达用户。`--no-remote` 时跳过。
- `upgrade` 命令 `selfUpdate.ts`：从最新 release 下载 `cli.js` 资产（`releases/download/<tag>/cli.js`，走对象存储、不占 API 配额）→ 下载 `cli.js.sha256` 校验 → 写临时文件 → 原子 `rename` 覆盖自身（POSIX 安全，替换正在运行的文件不影响当前进程）→ 输出 `{ upgraded: true, from, to }`。校验失败则中止并保留原文件。

**安全**：仅 HTTPS；`cli.js` 强制 sha256 校验；远程 JSON 一律当数据处理（不 eval、不当指令）；OWNER/REPO 固定。

### D9 — 配置项（env）

| env | 默认 | 说明 |
|---|---|---|
| `PHAROS_RPC_URL` | 公共 Pharos 主网 RPC | 覆盖 RPC 节点；**不硬编码含 key 的第三方节点** |
| `PHAROS_RWA_CACHE_DIR` | `~/.cache/pharos-rwa` | 缓存目录 |
| `PHAROS_RWA_CONFIG_URL` | 上述 raw 地址 | 覆盖远程配置源（开发用） |
| `PHAROS_RWA_NO_REMOTE` | 未设 | 等价 `--no-remote` |

RPC 默认值需在实现时确认一个可用的公共 Pharos 主网 RPC（chainId 需与 URL 匹配，否则 ethers6 首次请求抛 "network changed"）。

### D10 — 类型与精度

- TS strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`（金融数据 + 异构外部源，值得）。
- 大整数一律 BigInt 中间步骤，仅展示阶段转 Number（参考 `money.ts`）。totalAssets/份额量级可能超 `Number.MAX_SAFE_INTEGER`。
- 不引入 zod：手写 narrowing + 对异构 API 响应做容错取值（字段缺失即降级）。
- 跨文件共享类型集中 `types.ts`：`Metric`/`ActionPeriod`/`Position`/`VaultMarket`/`AdviceBundle` 等。

### D11 — 输出 JSON 形状（约定）

各命令输出顶层含 `{ ok, generatedAt, updateAvailable?, data, errors? }`。示例（`position`）：

```jsonc
{
  "ok": true,
  "generatedAt": "2026-07-27T09:00:00Z",
  "data": {
    "address": "0x...",
    "positions": [{
      "vault": "APC3M",
      "shares": "123.45",
      "nav": 1.03,
      "currentValue": 127.15,
      "estimated": true,
      "assumptions": { "entryNav": 1.0 },
      "principal": 123.45,
      "realizedYield": 3.70,
      "depositedDurationDays": 7,
      "lockEnd": "2026-10-20T...",
      "expectedTotalYield": 4.32,
      "actionPeriod": { "start": "...", "end": "...", "source": "config", "isOpen": false, "opensInDays": 85 }
    }]
  },
  "errors": []
}
```

失败隔离：某金库链上读取失败 → 该项 `{ vault, error }` 进 `errors`，其余正常返回，`ok` 仍可为 true（部分成功）。

### D12 — 复用的开源工具（调研结论）

在写代码前调研了自更新 / CLI / skill 脚手架的现成方案，结论：

- **Skill 脚手架 → 复用 Anthropic 官方 `skill-creator`（本地已安装）**。用它交互式生成 SKILL.md + frontmatter、`quick_validate.py` 校验结构、`improve_description.py` 优化触发词、eval harness 用 subagent 测触发命中率。均为 dev-time Python 工具，**不进运行时 bundle**。配合 superpowers `writing-skills` 最佳实践。注意其默认布局（references/scripts/assets/evals）偏文档型 skill，我们是代码型（src/ + cli.js），**布局仍按 D2，仅借用它写/校验/eval SKILL.md**。
- **CLI 框架 → `commander`**（标准、可干净 tree-shake 进 bundle）。
- **自更新（v1 JS）→ 手写（不复用库）**。`update-notifier` / `tiny-updater` / `simple-update-notifier` 均基于 **npm registry**，与我们的 GitHub Releases + raw config 模型不符；且 `update-notifier` 用动态 import + 子进程，**无法被 esbuild 打包**。调研未发现广泛采用、活跃维护的 Node 库专做"从 GitHub Release 资产自更新"。故维持 D8 的 ~50 行手写方案。
- **自更新（v2 Go）→ 复用 `go-github-selfupdate`（或活跃 fork `creativeprojects/go-selfupdate`）**。原生实现"检测最新 release → 按 OS/arch 下载二进制 → 自替换 → 回滚 → hash/签名校验"，正是本项目模式。v2 迁 Go 时直接采用，省掉自更新实现。

参考：anthropics/skills（skill-creator）、Agent Skills 官方文档、tiny-updater / simple-update-notifier / cli-autoupdater、rhysd/go-github-selfupdate。

## Risks / Trade-offs

- **[APC3M action period 每期需手动更新]** → 靠远程 `config/vaults.json`，在 GitHub 改一次即全用户生效；文档写明每期流程。仍是人工触发，遗忘会导致日期过期 → 输出对已过期窗口标注 `stale` 提示。
- **[epoch-NAV 近似偏差]** → 全程 `estimated:true` + `assumptions`；中途入场/非 1.0 起始会偏，v2 精确化。
- **[公开 API schema 漂移]** → 取值容错 + 字段缺失降级；查询集中在 sources 层单文件。
- **[Pharos RPC 不稳定/限流]** → 超时 + 单次重试 + 失败降级为该金库 error；RPC 可 env 覆盖。
- **[远程配置/Release 供应链风险]** → HTTPS + sha256 校验 + OWNER/REPO 固定 + 远程内容当数据。
- **[GitHub API 限流]** → 版本检查每日缓存；资产下载走对象存储不占配额。
- **[缓存文件损坏]** → 读时 try/catch + JSON 校验，损坏即当作无缓存。
- **[v2 Go 移植]** → v1 三层隔离 + 计算层纯函数，降低移植成本；JSON 输出契约即两版共同验收标准。

## v1 验收标准

- `node cli.js vaults` 返回 harbor 全金库市场概览 JSON。
- `node cli.js position <addr>` 对持有 APC3M/pALPHA 的地址返回持仓总览（含 estimated 标注、action period、预期收益）。
- `node cli.js reminders <addr>` 返回该地址相关金库的 action period 提醒摘要（含紧迫度）。
- `node cli.js advise <addr>` 返回市场 + 持仓 + 缺口信号合并包。
- `node cli.js upgrade` 能从 GitHub Release 校验并自替换 `cli.js`。
- 远程 `config/vaults.json` 改动后，用户下次运行（缓存过期后）自动生效；离线时回退内置默认可用。
- 单个数据源/金库失败不影响其他输出。

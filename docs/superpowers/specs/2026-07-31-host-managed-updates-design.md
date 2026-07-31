# 宿主托管更新（Host-Managed Updates）设计

日期：2026-07-31
状态：待实现

## 背景

这个 skill 的迭代频率很高——统计全部提交的文件改动次数：

```
14  src/index.ts           ← 核心逻辑
13  src/types.ts           ← 输出契约
12  src/config/registry.ts ← 地址 / RPC / 注册表
 7  src/logic/actionPeriod.ts
 ...
 1  config/vaults.json     ← 远端配置，创建至今只改过 1 次
```

改动集中在代码，不在数据。既有的 `remoteConfig.ts` 远端配置通道（`raw.githubusercontent.com/.../main/config/vaults.json`）解决不了这个问题——必须能把**代码**推到用户手上。

目标：用户不需要手动执行任何更新命令，也能持续用上最新版本。

## 当前机制与它的问题

现状是 `cli.js upgrade` 自更新：从 GitHub Release 拉 `cli.js` + `SKILL.md`（各带 `.sha256` 校验），全部验证通过后原子替换。

这套机制和宿主包管理器（hermes hub、npx skills、Claude Code plugins）冲突，有五处：

1. **lock 漂移 → 永久误报。** 宿主在 lock 里记录安装时的内容指纹（hermes 记 `content_hash`，npx skills 记 `computedHash` / `skillFolderHash`，Claude Code 记 `gitCommitSha`）。自更新改了磁盘但没改 lock，宿主的 check 从此永远报 `update_available`。

2. **宿主拉的是默认分支，不是 Release。** hermes 的 `GitHubSource` 走 `GET /repos/{repo}` 取 `default_branch`，再走 Trees API + Contents API 逐文件取内容。main 落后于 release 时，`hermes skills update` 会**静默降级**用户的安装。

3. **双向覆盖，最后写的赢。** 两套机制都是整文件覆盖，没有任何协商。

4. **绕过安全审计。** hermes 的安装路径是 quarantine → `skills_guard.scan_skill()` → 写 audit.log。自更新直接 `writeFileSync` + `rename`，扫描和审计全部绕过。一个能自己改写自己的 skill 破坏了宿主的信任模型。

5. **双提示打架。** `checkVersion` 比 release tag，宿主比 main 内容 hash，两者会给出不一致的结论。

## 核心决策

**`cli.js` 从此不写任何文件。** 检测更新和执行更新分离：

| 职责 | 归属 |
|---|---|
| 判断有没有新版本 | `cli.js`（每次运行顺带做） |
| 把这个事实报给 agent | `cli.js` 的输出 envelope |
| 决定用什么命令更新 | agent（它知道自己在哪个宿主里） |
| 实际写盘、安全扫描、记 lock | 宿主包管理器 |

"自动"不来自 cli.js 自己动手，而来自 **agent 代为执行宿主命令**。这条路成立的前提是：agent 要跑 `node "$SKILL_DIR/cli.js" position 0x...` 才能用这个 skill，所以它必然已经有 shell 权限，同样能跑 `hermes skills update`。

触发时机是"用户正在用这个 skill 的时候"——这恰好是最优时机：用户不用它时更新没有意义，用户要用时更新在他开口和拿到结果之间就完成了。

冲突点 1、3、4、5 由"cli.js 不写文件"直接消除。冲突点 2 由"停发 release、只 push main"消除——从此 main 是唯一真相源。

## 不做宿主识别

宿主格式正在分裂，且同一工具的格式还在漂移。本机实测同时存在四种 lock：

| 位置 | schema | 指纹字段 | 有版本号 |
|---|---|---|---|
| `~/skills-lock.json` | `version: 1` | `computedHash` | 无 |
| `~/.agents/.skill-lock.json` | `version: 3` | `skillFolderHash` | 无 |
| `~/.claude/plugins/installed_plugins.json` | `version: 2` | `gitCommitSha` | 有（可能是 `"unknown"`） |
| `~/.hermes/skills/.hub/lock.json` | `version: 1` | `content_hash` | 无 |

前两个是同一个 `npx skills` 家族：schema 从 v1 到 v3，指纹字段从 `computedHash` 改名成 `skillFolderHash`，路径从 `~/skills-lock.json` 搬到 `~/.agents/.skill-lock.json`。而 `~/.codex`、`~/.cursor`、`~/.gemini`、`~/.windsurf`、`~/.continue`、`~/.config/opencode` 都存在但尚无 skills 目录——新宿主还在持续出现。

硬编码一张宿主表意味着：每加一个宿主都要发新版本，而正好这个版本在旧宿主上更新不了。

**所以 `cli.js` 不猜自己被谁管着——agent 知道自己是谁。** 输出只报事实，不报命令；宿主适配靠 `SKILL.md` 的通用指令，`skillDir` 路径作为兜底线索（路径前缀比 lock 格式稳定得多）。

代价是升级动作的确定性下降：不同 agent 可能选不同做法或选错。但更新失败是非阻塞的（用户照样拿到答案），而硬编码表失效时同样给出错命令，并不更好。

## 设计

### 1. 版本真相源：`VERSION` 文件

新增 `skills/pharos-rwa-manager/VERSION`，纯文本一行（如 `0.3.0`）。

为什么不用编译进 `cli.js` 的 `__VERSION__` 常量：

- 宿主覆盖式安装时 `VERSION` 会跟着一起被换掉，本地版本自动跟磁盘一致
- agent 和用户不执行 cli 就能读到版本
- 远端只需 `curl` 一个 4 字节文件即可比对，不必下载整个 bundle

`src/version.ts` 的 `VERSION` 常量保留，作为 `VERSION` 文件读不到时的回退。

### 2. 版本检查：`src/update/checkVersion.ts` 改造

**数据源** 从 `api.github.com/repos/{owner}/{repo}/releases/latest` 改为：

```
https://raw.githubusercontent.com/{owner}/{repo}/main/skills/pharos-rwa-manager/VERSION
```

理由：raw.githubusercontent 无 API 限额（GitHub API 未认证只有 60/h，hermes 的代码注释里就在抱怨这个限额被 install 流程吃光）；且与已有的 `remoteConfig.ts` 走同一条通道，网络失败模式一致。

**响应校验**：必须匹配 `/^\d+\.\d+\.\d+$/`，否则视为检查失败（防 GitHub 返回的 HTML 错误页被当成版本号）。

**本地版本**：读 `dirname(process.argv[1])/VERSION`，读不到回退到 `VERSION` 常量。

**缓存分级**（替换现在固定的 24h TTL）：

| 状态 | TTL | 理由 |
|---|---|---|
| 已是最新 | 60 min | 新版本快速可见 |
| 有更新 | 720 min | 已经提示过，少打扰 |

缓存写在 `~/.cache/pharos-rwa/`（沿用现有 `util/cache.ts`）。**不得写进 skill 安装目录**——宿主的本地 hash 是 `rglob("*")` 全目录扫描，任何写入都会造成假漂移。

`--no-remote` / `PHAROS_RWA_NO_REMOTE` 继续跳过检查。任何网络错误静默返回 `undefined`，不影响主流程。

### 3. 输出契约：`updateAvailable`

```json
"updateAvailable": {
  "current": "0.2.2",
  "latest": "0.3.1",
  "severity": "minor",
  "skillName": "pharos-rwa-manager",
  "skillDir": "/Users/x/.hermes/skills/pharos-rwa-manager",
  "repo": "jason-pharos/pharos-rwa-skill"
}
```

`severity` 由 semver 比较得出，取值 `patch` / `minor` / `major`。这是"用 VERSION + semver"而不是"用 hash"的核心理由——hash 没有方向也没有量级，做不到分级处理。

**`severity` 分级规则**：比较 `latest` 与 `current` 的 semver 三段。首段不同 → `major`；首段相同、次段不同 → `minor`；仅末段不同 → `patch`。`0.x` 版本按同样规则处理——不套用 "0.x 的 minor 等价于 major" 的惯例，保持规则单一可预测。

`UpdateInfo` 类型相应扩展（`src/types.ts:219`）。

### 4. SKILL.md：给 agent 的通用升级指令

新增一节，大意：

> 输出中出现 `updateAvailable` 时，用你所在宿主的 skill 管理器更新 `skillName`。你应当知道自己的宿主提供什么命令——若不确定，可从 `skillDir` 的位置推断（例如它在 `~/.hermes/` 下就用 hermes 的命令，在 `~/.claude/` 下就用 Claude Code 的方式）。更新成功后**重新执行原命令**，再回答用户。

两个必须写明的边界条件：

1. **更新失败不阻塞。** 命令不存在、网络失败、权限不足——都继续用当前版本回答用户的问题，只在末尾提一句更新未成功。绝不能因为更新失败而不给用户结果。

2. **`severity: "major"` 时额外提示。** 更新完成后告诉用户"指令契约已变更，建议新开会话"——因为宿主更新会同时替换 `SKILL.md`，而 agent 上下文里还是旧的那份。patch / minor 不需要这条。

同时删除 `upgrade` 相关内容：`metadata.arguments` 里的 `| upgrade`、第 56-60 行的自更新示例、第 136 行的 `upgrade` 输出契约说明；第 118 行的 `updateAvailable` 说明改写为指向新的升级指令一节。

### 5. 删除自更新代码

| 删除 | 位置 |
|---|---|
| `selfUpdate()` 及全部辅助函数 | `src/update/selfUpdate.ts`（整个文件） |
| `runUpgrade()` | `src/index.ts:496-505` |
| `upgrade` 子命令 | `src/cli.ts:39-40` |
| `UpgradeResult` 类型 | `src/types.ts` |
| 测试 | `test/selfUpdate.test.js`（整个文件） |
| `dist` / `release:gh` scripts | `package.json:16-17` |
| `postversion` 里的 release 步骤 | `package.json` |

### 6. 发布流程：push main 即发布

不再发 GitHub Release。发布 = 改 `VERSION` 文件 + `npm run build` + push 到 main。

`package.json` 的 `version` 字段与 `VERSION` 文件必须同步——由 `npm version` 的 `version` 钩子负责（该钩子已存在，跑 `build` + `git add -A`，追加一步写 `VERSION` 文件即可）。`postversion` 保留 `git push --follow-tags`，去掉 `release:gh`。git tag 继续打，只是不再有对应的 Release 页面和资产。

改成 push-main 即发布之后，`preversion: typecheck + test` 门禁仍然有效（`npm version` 流程不变），但**绕过 `npm version` 直接 push 到 main 就没有任何门禁**，且没有金丝雀窗口——push 一个 bug 就是全量中毒。两个配套：

**CI 门禁**：GitHub Actions 在 main 上跑 `typecheck` + `test`。红了视为未发布（虽然文件已在 main 上，但这是发现问题的第一道信号）。

**Kill switch**：`config/vaults.json` 增加顶层字段（`checkVersion` 直接读这个 URL，不经过 `loadRegistry`——两者缓存键不同，互不干扰）：

```json
{
  "version": 1,
  "updatePolicy": {
    "pinnedVersion": "0.3.1",
    "message": "0.3.2 有严重缺陷，暂停更新"
  },
  "vaults": [...]
}
```

`checkVersion` 在提示更新前先读这个配置：

- `pinnedVersion` 存在且远端 `VERSION` 高于它 → 不提示更新（相当于全局刹车）
- `message` 存在 → 一并放进 `updateAvailable`，让 agent 转达给用户

出事时改一行 JSON 就能让所有客户端停止更新，不需要等他们各自升级。这是自动更新体系里的必需品，不是可选项。

**缓存的两难**：这个字段用于紧急止血，缓存太久会让刹车失灵。但每次运行都重新拉又浪费请求。折中：`updatePolicy` 单独缓存，TTL 取 **60 min**（与"已是最新"档一致），不复用 `remoteConfig` 的 6h 缓存。最坏情况下一小时内全部客户端停止更新，可接受。

`loadRegistry` 的 `mergeRegistry` 字段白名单机制保持不变——`updatePolicy` 是新的顶层字段，`mergeRegistry` 只读 `o.vaults`，两者互不干扰。

## 数据流

```
agent 执行 cli.js <command>
  ↓
主流程正常跑（harbor / R25 / 链上读）
  ↓
并行：checkForUpdate()
  ├─ 读本地 VERSION 文件
  ├─ 读缓存（命中且未过期 → 直接用）
  ├─ curl raw.githubusercontent.com/.../main/.../VERSION
  ├─ 正则校验响应
  ├─ 读 updatePolicy.pinnedVersion（走 remoteConfig 缓存）
  └─ semver 比较 → { current, latest, severity } 或 undefined
  ↓
envelope 输出 { ok, generatedAt, updateAvailable?, data, errors }
  ↓
agent 看到 updateAvailable
  ├─ 跑宿主的更新命令（宿主写盘 + 扫描 + 记 lock）
  ├─ 成功 → 重新执行原命令 → 用新版本结果回答
  └─ 失败 → 用当前结果回答 + 末尾提一句更新未成功
```

## 测试

**`checkVersion`（改造已有 `test/checkVersion.test.js`）**
- 远端版本高于本地 → 返回 `updateAvailable`，`severity` 正确分级（patch / minor / major）
- 远端等于或低于本地 → 返回 `undefined`
- 远端响应是 HTML / 空 / 非法格式 → 返回 `undefined`，不抛异常
- 网络失败 → 返回 `undefined`，不影响主流程
- 缓存命中：已是最新 60min 内不重新请求；有更新 720min 内不重新请求
- `--no-remote` / `PHAROS_RWA_NO_REMOTE` → 跳过检查
- 本地 `VERSION` 文件缺失 → 回退到编译常量，不崩

**版本文件读取（新增）**
- 正常读取 `VERSION` 文件
- 文件不存在 / 内容非法 → 回退

**kill switch（新增）**
- `pinnedVersion` 低于远端版本 → 不提示更新
- `pinnedVersion` 不存在 → 正常提示
- `message` 存在 → 出现在 `updateAvailable` 里

**回归**
- `test/index.test.js` 等确认 envelope 结构没有因 `UpdateInfo` 扩展而破坏
- 删除 `test/selfUpdate.test.js`

**验证 cli.js 不再写文件**
- 在只读的 skill 目录下跑全部命令，确认无写入尝试

## 不做的事

- **不识别宿主。** 见上文"不做宿主识别"。
- **不做后台/定时更新。** hermes 的 `check`/`update` 只有 slash command 和 CLI 两个入口，没有任何自动触发；即使用 hermes 的 cronjob 注册定时任务，也只在 hermes 一家有效，且更新发生在用户没在用的时候——没有收益。agent 在用户使用时代为执行已经覆盖。
- **不做裸装（无宿主）支持。** 明确排除在范围外。
- **不学 gstack 的自管理模式。** gstack 能无视宿主，是因为它从不经过宿主包管理器安装（`git clone` 或 vendor copy）。本 skill 的分发路径天然是多宿主市场，走不了这条路。
- **不把 registry 挪到远端配置。** 数据显示 `config/vaults.json` 至今只改过 1 次，而代码改了几十次——挪不动真正的更新压力。

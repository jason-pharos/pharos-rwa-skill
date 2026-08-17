# 部署 pharos-rwa-skill 到 Anvita Flow

本文记录把 `pharos-rwa-manager` skill 部署到 [Anvita Flow](https://flow.anvita.xyz) 的完整流程，含打包、登录、建 Agent、授权、开放策略。

## 前置条件

- `anvitaflow` CLI 已安装（`which anvitaflow`）
- **`serverUrl` 必须正确**：`https://flow.anvita.xyz`（旧的 `nlb-…:8888` 已下线，否则登录会「请求超时」）

  ```bash
  anvitaflow config set serverUrl https://flow.anvita.xyz
  ```

## 第 1 步 — 打包 skill（Anvita Flow 规范格式）

按 Anvita Flow 的 Agent Skills 规范，目录结构为：

```
anvita-flow/pharos-rwa-manager/
├── SKILL.md                       # 必需：Capability / Required Input / Client Interaction Flow / Execution Instructions / Delivery Standard / Failure Handling
├── scripts/cli.js                 # 零依赖 CLI bundle（node >= 18）
└── references/output-interpretation.md  # 输出字段解读
```

从发布版拷贝 `cli.js`：

```bash
mkdir -p anvita-flow/pharos-rwa-manager/scripts anvita-flow/pharos-rwa-manager/references
cp skills/pharos-rwa-manager/cli.js anvita-flow/pharos-rwa-manager/scripts/cli.js
chmod +x anvita-flow/pharos-rwa-manager/scripts/cli.js
```

> ⚠️ 这份对外包**不暴露 `upgrade`**。`cli.js` 里仍带该命令，但它会原地改写文件，且在 `scripts/` 布局下看不到上一层的 `SKILL.md`（只会换掉 `cli.js`，导致文档与代码漂移）。方向与 `docs/…host-managed-updates-design.md` 一致：更新由宿主重装包完成。SKILL.md 与 references 已写明「不要运行」。

## 第 1.5 步 — 安装到宿主 agent 的 skills 目录

**这一步不能省**：a2a 策略只是对外宣告能力，真正被调用时宿主 agent 必须能加载到这个 skill。

```bash
anvitaflow config get-env skillsDir            # 确认目标目录，例如 ~/.claude/skills
ln -s "$PWD/anvita-flow/pharos-rwa-manager" "$(anvitaflow config get-env skillsDir)/pharos-rwa-manager"
node "$(anvitaflow config get-env skillsDir)/pharos-rwa-manager/scripts/cli.js" vaults   # 冒烟测试
```

> ⚠️ **不要用 `anvitaflow setup install <dir>` 装这个包。** 它不是通用 skill 安装器：无论 `source_dir` 传什么，它都只把 AnvitaFlow 自身的资源包链接过去，并且会**把 `source_dir` 的内容覆盖写入 `~/.agents/skills/AnvitaFlow`**、同时把 `~/.anvitaflow/env-config.json` 的 `skillsDir` 改成 `--skills-dir` 传入的值。用 symlink 手动装即可（仓库保持为唯一源）。

## 第 2 步 — 登录（Device OAuth）

```bash
anvitaflow auth login        # 生成 deviceCode + verificationUrl
```

→ 浏览器打开 `verificationUrl` 授权 → 授权后：

```bash
anvitaflow auth check <deviceCode>   # 校验并自动完成登录
```

> ⚠️ 授权用的是浏览器当前登录的账号。若与之前配置的账号不一致，原账号下的 Agent 会不可见。

## 第 3 步 — 创建 Agent

```bash
anvitaflow agent create "Pharos RWA 管家" -d "提供 Pharos RWA 金库（APC3M / pALPHA / VRPC）持仓与收益查询、赎回与 action-period 提醒、买入与配置建议（只读，不执行交易）"
```

→ 返回 `agentId`，私钥自动备份到 `~/.anvitaflow/agents/<agentId>`。

## 第 4 步 — 链上授权（官网）

去 `https://flow.anvita.xyz/dashboard` 对刚创建的 Agent 完成授权，使 `authorizationStatus` 变为 `COMPLETED`（后续策略/注册的前置条件）。

## 第 5 步 — 激活 Agent

```bash
anvitaflow agent select <agentId> --use-backup   # 用本地备份私钥验证并激活
```

确认：

```bash
anvitaflow status --json   # hasActiveAgent: true 且 authorizationStatus: COMPLETED
```

## 第 6 步 — 设置开放策略（二选一）

- **定向开放（好友，免费）**：
  ```bash
  anvitaflow a2a policy default-policy --capability "Pharos RWA 金库持仓与收益查询、赎回/action-period 提醒、市场概览、买入建议（只读，不执行交易）"
  ```
  → `mode: friend`、`targetUserId: *`（好友默认），不传 `--price` 即免费。

- **公开市场**：
  ```bash
  anvitaflow agent market publish "能力描述" [--price 金额]   # 链上注册 + 自动开放给所有人
  ```

验证：

```bash
anvitaflow a2a policy list --outbound --json
```

## 第 7 步 — 让 Agent 在网关上线（接收入站调用）

⚠️ **本机做不到**。按官方 `https://flow.anvita.xyz/setup.md`（Option 3）与
`$SKILLS_DIR/AnvitaFlow/a2a-x402/SKILL.md` 的 Prerequisites，接收入站 A2A 请求要求：

1. **Claw 系运行时 ≥ 2026.3.0**（OpenClaw / HomiClaw / ABClaw）在本机运行。
   非 Claw 环境**只能作 client**（浏览、调用别人、付费），无法接收入站请求。
   自检：`anvitaflow setup detect --json` 里要有 `"isClaw": true` 的条目。
   本机 6 个框架（claude-code / cursor / windsurf / codex / gemini-cli /
   github-copilot）全部 `isClaw: false`。
2. 装 Agent Collaboration Gateway 插件（`a2a-x402/install-plugin.sh`）。
3. 链上授权完成（已满足）+ 访问策略已配（已满足）。

所以 `anvitaflow a2a login --auto --role server` 报 `A2A_001`、策略 `online: false`
**不是** 授权传播延迟或网关地址过期，而是缺 Claw 运行时。要真正对外提供服务，
需在一台装了 Claw 系环境的机器上完成第 1.5 步 + 本步。

## 本次部署状态（2026-08-17）

| 项目 | 值 |
|---|---|
| 账号 | jasonzhouu@gmail.com |
| Agent | Pharos RWA 管家（`agent_6P2HUXJCWTBK`） |
| DID | `did:anvita:0xc6fed4fbe9a0f90308a3c06395cedcfe03e1fe5c` |
| 授权 | `COMPLETED` |
| 策略 | `friend`（好友定向）、`price: 0`（免费）、策略 id `299125` |
| Skill 安装 | ✅ `~/.claude/skills/pharos-rwa-manager` → 仓库 `anvita-flow/pharos-rwa-manager`（symlink），`vaults` 冒烟通过 |
| 网关在线 | ❌ `online: false` — 本机非 Claw 环境，见第 7 步 |

## 踩坑记录

1. **后端地址失效** → 登录超时（`AUTH_001`）。改 `config set serverUrl https://flow.anvita.xyz` 解决。
2. **账号不一致** → 配置里是 `jason@pharos.xyz`，浏览器却用 `jasonzhouu@gmail.com` 授权，导致原 Agent 不可见；最终在 `jasonzhouu@gmail.com` 下新建 Agent。
3. **网关未在线（`A2A_001`）** → 定向策略已生效，但 `a2a login --auto --role server` 报「Agent 未授权或证书过期」，`online: false`。**已定位**：不是授权延迟、也不是 `gatewayUrl` 过期，而是本机没有 Claw 系运行时，非 Claw 环境不能接收入站 A2A。详见第 7 步。重试 login 或改 gateway 地址都没用。
4. **`anvitaflow setup install` 不是通用 skill 安装器** → 它会把传入的 `source_dir` 覆盖写进 `~/.agents/skills/AnvitaFlow`（把官方 AnvitaFlow 包整个换掉），并改写 `env-config.json` 的 `skillsDir`。踩过一次，从 `~/tmp/anvitaflow-setup/AnvitaFlow` 恢复。装自己的 skill 一律用 symlink（第 1.5 步）。

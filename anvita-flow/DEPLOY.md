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

## 本次部署状态（2026-08-17）

| 项目 | 值 |
|---|---|
| 账号 | jasonzhouu@gmail.com |
| Agent | Pharos RWA 管家（`agent_6P2HUXJCWTBK`） |
| DID | `did:anvita:0xc6fed4fbe9a0f90308a3c06395cedcfe03e1fe5c` |
| 授权 | `COMPLETED` |
| 策略 | `friend`（好友定向）、`price: 0`（免费） |

## 踩坑记录

1. **后端地址失效** → 登录超时（`AUTH_001`）。改 `config set serverUrl https://flow.anvita.xyz` 解决。
2. **账号不一致** → 配置里是 `jason@pharos.xyz`，浏览器却用 `jasonzhouu@gmail.com` 授权，导致原 Agent 不可见；最终在 `jasonzhouu@gmail.com` 下新建 Agent。
3. **网关未在线（`A2A_001`）** → 定向策略已生效，但 `a2a login --auto --role server` 报「Agent 未授权或证书过期」，`online: false`。疑为链上授权传播延迟，或 beta 网关（`beta-hub.unchartedw3s.com`）与新版主站之间有单独的授权步骤。可稍后重试或到 `flow.anvita.xyz/dashboard` 检查。

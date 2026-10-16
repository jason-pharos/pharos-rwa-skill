# Vault Epochs（多期配置）设计

日期：2026-10-16

## 背景与目标

APC3M 和 pALPHA 都是按"期"运营的 vault：APC 有 Season 1 / Season 2，pALPHA 有 Phase 2 / Phase 3。新一期开放存入时，上一期往往还没结束，两期时间会重叠。例如（UTC+8）：

- APC：S1 lock 到 2026-10-20 23:59:59 才结束，S2 的 Deposit Period (Pre) 从 2026-10-13 就开始了。
- pALPHA：Phase 2 lock 到 2026-10-20 19:00 结束，Phase 3 存入从 2026-10-20 15:00 开始。

目前 registry 每个 vault 只有一组时间配置（`actionPeriodConfig`）。上新一期只能覆盖旧配置，导致重叠期间老持仓用户查不到上一期的信息。

**目标**：每个 vault 支持配置多期。重叠期间，CLI 同时输出所有仍然有效的期，由 skill 文档告诉模型怎么区分、怎么向用户解释。

**已确认的业务规则**：上一期持仓在 action period 内没有赎回的，到期后会自动续到下一期。所以上一期过了 withdrawable 就不再输出。

## 范围

- **包含**：
  - APC3M 和 pALPHA 的多期配置。
  - position 和 reminders 输出多期信息。
  - APY 回退值按期、按档位取。
  - 文档更新。
- **不包含**：
  - VRPC-SemiYearly 和 VRPC-Weekly：它们按存入时间各自计算到期日，不按期运营，逻辑不变。
  - 兼容旧版 CLI。
  - 远程配置覆盖时间：时间配置只写在代码 registry 里，随发版更新。
  - `vaults` 命令（harbor 市场概览）。

## 数据模型

`VaultRegistryEntry` 删除 `actionPeriodConfig` 和 `depositPeriodConfig`，新增可选字段 `epochs`：

```ts
interface EpochTerms {
  from: string;               // ISO8601（带时区），本档从此刻起生效，直到下一档的 from
  label: string;              // 如 'Deposit Period (Pre)'
  grossApy: number;           // 小数，如 0.138
  /** performance fee 占 deposit APY 的比例（不含 rewards），如 0.1 */
  performanceFeeRate: number;
  netApy: number;             // 扣除 fee 后的 APY，如 0.125
}

interface Epoch {
  id: string;                 // 'apc-s1' | 'apc-s2' | 'palpha-p2' | 'palpha-p3'
  label: string;              // 'Season 1' / 'Phase 3'
  deposit?: { start: string; end: string };  // 存入期整体；没有数据时省略
  lockStart: string;
  lockEnd: string;
  actionStart: string;
  actionEnd: string;
  withdrawable: string;       // 完整 ISO8601 时间（不再只写日期），用于判断这一期是否仍然有效
  terms: EpochTerms[];        // 按 from 升序
}
```

APC S2 的 Pre / Extend 只是同一个存入期内的两档 `terms`，存入期本身是一整段 `deposit`。

### Registry 初始数据（全部为 UTC+8）

| 期 | deposit | lock | action period | withdrawable | terms |
|---|---|---|---|---|---|
| `apc-s1` Season 1 | 07-15 16:00 – 07-19 23:59 | 07-20 00:00 – 10-20 23:59:59 | 07-20 00:00 – 10-12 00:00 | 10-20 23:59:59 | 07-15 16:00 起：gross 0.14 / fee 0 / net 0.14（沿用原 `apyFallback`） |
| `apc-s2` Season 2 | 10-13 00:00 – 10-27 09:00 | 10-20 15:00 – 2027-01-21 15:00 | 10-13 00:00 – 2027-01-13 00:00 | 2027-01-21 15:00 | 10-13 00:00 起 `Deposit Period (Pre)`：0.13 / 0 / 0.13；10-20 15:00 起 `Deposit Period (Extend) & Lock`：0.138 / 0.1 / 0.125 |
| `palpha-p2` Phase 2 | （省略） | 07-20 19:00 – 10-20 19:00 | 09-17 11:00 – 10-01 00:00 | 10-20 19:00 | 07-20 19:00 起：0.14 / 0 / 0.14 |
| `palpha-p3` Phase 3 | 10-20 15:00 – 10-27 09:00 | 10-20 15:00 – 2027-01-21 15:00 | 12-18 11:00 – 2027-01-01 11:00 | 2027-01-21 15:00 | 10-20 15:00 起 `Deposit Period`：0.138 / 0 / 0.138；10-27 09:00 起 `Lock Period`：0.138 / 0.1 / 0.125 |

数据来源：

- APC S1：前端 `.env` 的 prod 值（action period 结束时间以 prod 的 10-12 为准）。
- APC S2：`apps/port/src/config/env.ts` 中的 `APC_SEASON2_DEFAULTS`，以及 `apcContent.ts` 中的 `SEASON2_APY`。
- pALPHA P2：skill 原有配置。
- pALPHA P3：`apps/port/src/views/deposit/pAlphaPhase3.ts`。

## 选期逻辑（`src/logic/epochs.ts`）

`resolveEpochs(entry, now) → { epochs: EpochView[]; errors: {scope, error}[] }`

1. **校验**：以下任一情况，这一期跳过，并记一条 `scope: 'epochs:<id>'` 错误：
   - 有时间解析失败。
   - `lockEnd <= lockStart`、`actionEnd <= actionStart`、`deposit.end <= deposit.start`。
2. **判断有效**：`now < withdrawable` 的期才算有效，还没开始的期也算。
3. **排序和角色**：有效期按 `lockStart` 升序排列。第一个是 `role: 'current'`，即老持仓所在的期；其余是 `'next'`。
4. **状态 `status`**：
   - `upcoming`：`now < (deposit?.start ?? lockStart)`。
   - `deposit-open`：`deposit` 存在，且 `deposit.start <= now < deposit.end`。
   - `locked`：其他情况，即存入已结束（或没有存入期且 lock 已开始），且在 withdrawable 之前。
5. **当前档位 `currentTerms`**：取 `from <= now` 的最后一档。`now` 早于第一档时取第一档，表示开始后的条件。没有配置任何档位时为 `null`。

`EpochView` 的结构：

```ts
interface EpochView {
  id: string; label: string;
  role: 'current' | 'next';
  status: 'upcoming' | 'deposit-open' | 'locked';
  deposit: { start: string; end: string; isOpen: boolean } | null;
  lockStart: string; lockEnd: string;
  actionPeriod: ActionPeriod;      // source: 'config'，复用现有 build()
  withdrawable: string;
  currentTerms: EpochTerms | null;
  terms: EpochTerms[];
}
```

示例：

- 2026-10-16：APC 输出 S1（`current` / `locked`）和 S2（`next` / `deposit-open`，Pre 档）；pALPHA 输出 P2（`current` / `locked`）和 P3（`next` / `upcoming`）。
- 2026-10-21：APC 只剩 S2（`current` / `deposit-open`，Extend 档）；pALPHA 只剩 P3（`current` / `deposit-open`）。

## 输出变化

### position

- **新增 `epochs: EpochView[]`**：仅对配置了 `epochs` 的 vault 输出。
- **原有字段语义不变**：顶层的 `actionPeriod`、`lockEnd`、`depositedDurationDays`、`expectedTotalYield` 改为由 `current` 期计算，即原来的 `actionPeriodConfig` 换成 `current` 期。APC3M 的 R25 `/vault/period` 窗口按到期日归属到对应的期：R25 `nextMaturityDate` 与某个有效期的 `withdrawable` 相差不超过 1 天，就把 R25 窗口作为该期的 `actionPeriod`（重叠期间 R25 往往已经返回下一期的窗口）。匹配到 `current` 期时顶层 `actionPeriod` 用 R25；匹配到 `next` 期或都匹配不上（含 R25 没有 `nextMaturityDate`、接口不可用）时顶层用 `current` 期的配置日期。因此顶层 `actionPeriod` 始终与 `epochs[current].actionPeriod` 一致。没有有效期但 R25 有数据时，顶层 `actionPeriod` 用 R25（无从匹配，但好过没有）。
- **删除 `depositPeriod`**：上一个 commit 新增的这个字段，已被 `epochs` 取代。
- **APY 回退值**：R25 没有返回 APY 时，使用 `current.currentTerms.netApy`；没有档位时才用 `entry.apyFallback`。由 `epochApy(entry, now)` 实现，取代 `configApy`。
- **`errors`**：`resolveEpochs` 产生的错误并入 position 的 `errors` 输出。
- **没有有效期时**（所有期都过了 withdrawable）：`epochs: []`，顶层 `actionPeriod.source = 'unavailable'`（APC3M 的 R25 有数据时为 `r25-api`），`lockEnd`、`expectedTotalYield` 为 `null`。

### reminders

- **按期输出**：配置了 epochs 的 vault，每个有效期各出一条 `Reminder`，新增 `epoch: string` 字段，消息以 `<vault> <label>:` 开头。
  - 紧急程度沿用现有的 `classify` 规则，按该期的 `actionPeriod` 计算。
  - 存入期开放时，消息末尾追加 `Deposit open until <date> (<label> net APY x%).`。
- **没有有效期时**：输出一条 `unknown` 提醒：`<vault>: no active epoch configured; config may be stale.`
- **日期来源**：每一期的提醒都用该期自己的 `actionPeriod`。APC3M 的 R25 窗口只挂在 `withdrawable` 与 R25 `nextMaturityDate` 相差不超过 1 天的那一期上，其余期用配置日期（规则见上文 position 部分）。没有有效期时，如果顶层 `actionPeriod` 可用（R25 有数据），照常出一条普通提醒；否则出 `unknown` 提醒。
- **上一期的赎回窗口已过**：紧急程度仍为 `closed`，但消息改为 `<vault> <label>: withdraw window for this epoch has closed; holdings roll over into the next epoch after <withdrawable>.`，不再沿用"config may be stale"的提示。
- **VRPC**：不变。

## 远程配置

- `mergeRegistry` 删除对 `actionPeriodConfig` 和 `depositPeriodConfig` 的合并，只保留 `apyFallback` 和 `entryNavBaseline` 的覆盖。
- `config/vaults.json` 删除时间字段。

## 错误处理汇总

| 情况 | 处理 |
|---|---|
| 某一期时间解析失败或起止顺序颠倒 | 跳过这一期，`errors` 记一条 `epochs:<id>` |
| 没有有效期 | `epochs: []`，`actionPeriod` 为 unavailable，提醒为 `unknown`（配置可能已过期）；APC3M 的 R25 有数据时 `actionPeriod` 用 R25，出普通提醒 |
| `now` 早于第一档 | `currentTerms` 取第一档 |
| 没有配置档位 | `currentTerms: null`，APY 回退到 `apyFallback` |

## 测试

使用 `node:test`，所有用例都传入固定的 `now`。

- **`epochs.test.js`**：
  - **APC 选期**：在 10-16、10-21、2027-02-01 三个时间点检查有效期、`role`、`status` 和 `currentTerms`。
  - **pALPHA 选期**：在 10-16、10-20 16:00、10-28 三个时间点做同样的检查。
  - **档位切换**：APC 在 10-20 15:00 从 0.13 切到 0.125；pALPHA P3 在 10-27 09:00 从 0.138 切到 0.125。
  - **配置写错**：时间解析失败或顺序颠倒的那一期被跳过，并出现在 `errors` 里。
  - **`epochApy`**：按档位返回净 APY；没有有效期时回退到 `apyFallback`。
- **`position.test.js` / `position-palpha.test.js` / `buildPositions.test.js` / `actionPeriod.test.js`**：测试夹具从 `actionPeriodConfig` 改为单期 `epochs`，原有断言结果不变。
- **`reminders`**：每期一条提醒，消息带期名前缀；存入期开放时追加存入信息；没有有效期时输出 `unknown`。
- **`remoteConfig.test.js`**：
  - registry 中四期的数据与上表一致。
  - 远程覆盖不再影响时间字段。
  - 删除上一个 commit 中关于 `depositPeriodConfig` 合并的测试。

## 文档

- **`skills/pharos-rwa-manager/SKILL.md` 和 `anvita-flow/pharos-rwa-manager/references/output-interpretation.md`**：
  - 用 `epochs` 的说明替换 `depositPeriod` 那一条。
  - 重叠期间会输出多期：`current` 是老持仓所在的期，`next` 是新存入对应的期，到期后自动续期。
  - 回答时要标明是哪一期，不要混用两期的日期或 APY。
  - APC 的 Pre / Extend 是同一个存入期内的两档 APY/fee，不是两个存入期。
  - 更新 pALPHA 的举例日期。
- **`DEV.md`**："Vault Types & Action Period Sources" 一节改为 epochs 说明，并补充上线新一期的方法：在 registry 里追加一条 epoch，然后发版。
- **构建**：重新 build `skills/pharos-rwa-manager/cli.js`，并拷贝到 `anvita-flow/pharos-rwa-manager/scripts/cli.js`。

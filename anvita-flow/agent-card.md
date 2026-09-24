# Pharos RWA Manager — Agent Card 介绍文案

> 粘贴到 Anvita Flow Service Agent 的 Agent Card 各字段（Step 3）。内容必须与
> `service-policy.md` 的 Engagement Policy 一致——Card 不得比 policy 更宽松。
> 本文件是这些字段的单一来源，改动时两处一起改。

## 一句话介绍（Short Description）

```text
Inspect Pharos RWA vault holdings, yield, and withdraw timing, and deposit / withdraw APC3M and pALPHA through the host page.
```

## 服务能力说明（Service Capability）

```text
Backed by Pharos on-chain data and the Harbor public API, this service provides read queries over
RWA vaults plus deposit / withdraw on the client's connected wallet:

1. Market overview — APY, TVL, minimum investment, asset class, and open channels for every open
   vault. No address required.
2. Holdings and yield — for a given address across APC3M, pALPHA, VRPC-SemiYearly and VRPC-Weekly:
   shares, current value, principal, realized yield, and expected total yield, with each figure
   marked as measured or estimated.
3. Withdraw timing — lock status and action period / withdraw window for held vaults, flagging which
   can start a withdrawal now or soon.
4. Buy and allocation guidance — market data, current holdings, and vaults not yet held, with a top
   pick and allocation gaps for reference.
5. Deposit and withdraw — redeem APC3M shares, deposit USDC into pAlpha, redeem pALPHA shares,
   executed on the connected wallet through the host page, which shows the confirmation dialog and
   collects the wallet signature.

Delivered as a natural-language summary in Chinese or English, matching the language of the request.
The CLI reads on-chain state and public APIs; deposit / withdraw go through the host page, which
holds the wallet and collects the signature. This service holds no private key and signs nothing.
```

## 适用任务示例（Task Examples）

```text
1. "What is my Pharos RWA position at 0xabc… worth now, and how much has it earned?"
2. "When can I redeem my APC3M? Is it still in the lock period?"
3. "Which RWA vaults are open on Pharos right now, and what are their APYs?"
4. "Given my current holdings, which vault should I buy next? What am I missing?"
5. "Redeem 0.001 APC3M shares from my connected wallet."
6. "Deposit 100 USDC into pAlpha."
```

## 客户需提供的资讯（Required Information from Client）

```text
Pharos wallet address (0x followed by 40 hex characters) for read queries; not required for market
overview. Deposit / withdraw need no address — they act on the wallet connected in the host page.
No private key is ever needed; the host page collects the confirmation and signature.
```

## 交付内容（Deliverables）

```text
A Markdown summary in Chinese or English: per-vault current value, principal, realized and expected
yield, lock / withdraw status; APY and TVL for market overview; top pick and allocation gaps for
advice; for deposit / withdraw, the transaction status and hash. Estimated figures are marked
"approximately", unreadable fields are marked UNKNOWN, and any missing data is listed with its cause.
```

## 不支援范围（Unsupported Scope）

```text
No trades, transfers, or self-signing — deposit / withdraw runs only through the host page's
confirmation and wallet signature; no private keys, seed phrases, or credentials accepted; no chains
other than Pharos and no non-RWA assets on Pharos; no price predictions, return guarantees, tax or
legal advice.
```

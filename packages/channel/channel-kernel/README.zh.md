---
description: "Provider-neutral enterprise channel routing, reliability, identity, and audit contracts。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-channel-kernel`

[English](README.md) | 中文

## 概述

Provider-neutral enterprise channel routing, reliability, identity, and audit contracts。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

企业消息的纯 Channel Kernel 合同：

- 解析 `/员工`、`/employees`、`/切换` 和 `/switch` 命令。
- 在单个渠道允许的员工集合上执行 Sticky Employee、意图和默认路由。
- 生成企业规范用户和渠道本地 actor key。
- 生成提供方作用域内的入站幂等键和有上限的出站重试时间。
- 计算 Token/心跳健康状态和失败关闭的 Session 自愈决策。
- 记录包含内容哈希和长度的消息审计元数据，不记录原始内容或凭据。
- 提供面向企微、飞书、钉钉与个人微信的 provider-neutral `ChannelEnvelope`，通过稳定 operation id 关联 DSH Team 与 Run 身份。
- 失败关闭的意图策略：企业渠道可以提交经过授权的 Team 与决策意图；个人微信网站应用授权仅允许经认证的 DSH 接管。

本包不登录微信、不托管企微 webhook、不持久队列、不发送消息。这些属于适配器职责，并且必须使用 DSH Credentials 和原生 Session，而不是私有副本。

## Model Experience

### Host 渠道策略

#### What the model sees

无。`routeInbound` 和其他内核函数执行确定性 Host 侧身份、路由、可靠性和审计决策；不贡献 Prompt 分区、Message、Tool Schema、Tool Result 或模型调用。

#### Token effect

无。提供方适配器以后可以通过普通 Session Message 路径交付已接纳的渠道内容，其 Token 成本属于该路径，不属于本内核。

#### KV Cache effect

无。内核既不组装也不修改提供方请求。

## Known Limitations and Deferred Work

- 未包含真实飞书与钉钉适配器；个人微信聊天传输不在范围内，既有企微 adapter 尚未实现完整 Team envelope 命令面。
- 部署适配器必须提供持久幂等和 outbox 存储。
- 意图识别提供员工候选；本包只校验并排序该候选。
- provider acknowledgement、unknown-outcome 对账与 receipt 存储仍属于 adapter 职责。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

---
description: "企业渠道内核与提供方适配器。"
kind: "package-group"
---
# 渠道包

[English](README.md) | 中文

## 概述

企业渠道内核与提供方适配器。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

与提供方无关的企业渠道合同。[`channel-kernel`](channel-kernel/README.zh.md) 负责路由和可靠性决策；提供方适配器负责微信/企微登录、传输、持久入站/出站存储和回执。

当前 GA 支持的提供方适配器是 [`channel-wecom`](channel-wecom/README.zh.md)，只实现企业微信企业应用的线格式和安全合同，明确排除个人微信。HTTP 服务、PostgreSQL 入站／出站持久化、凭据、租约和实际投递仍由 Host 负责。

[Webhook 子系统](../../docs/subsystems/webhook.zh.md)说明提供方适配器组合的统一入站 HTTP 与投递生命周期。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

---
description: "Enterprise WeCom application callback and delivery contracts。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-channel-wecom`

[English](README.md) | 中文

## 概述

Enterprise WeCom application callback and delivery contracts。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

DSH 的企业微信企业应用适配器合同。本包只支持企业微信企业应用；个人微信和个人号自动化明确不在产品边界内。

本包提供：

- 常量时间 SHA-1 回调验签；
- 企业微信 AES-256-CBC、32 字节 PKCS#7 回调信封和 URL 校验；
- 与传输无关的快速 `success` ACK 合同；
- 入站身份规范化及 Channel Kernel 幂等键；
- Token 临期／过期和入站心跳健康提醒；
- 确定性的、理解提供方错误的出站重试／死信决策。

本包不包含 HTTP 客户端、Webhook 服务、Token 缓存、数据库或消息发送器。Host 必须在持久化接纳前完成验签并返回快速 ACK，然后由 PostgreSQL 入站／出站 Worker 异步处理解密信封。凭据值必须来自 DSH Credentials，不得写入审计记录。

## 可靠性边界

`nextWeComDeliveryAttempt` 只返回决策，不休眠也不发送。持久化 Worker 负责租约／fencing、幂等 Outbox 认领、重试持久化、提供方回执和死信回放。提供方 `Retry-After` 最长遵循 24 小时；非瞬态 HTTP 错误失败关闭。

## Model Experience

### 提供方线格式转换

#### 模型可见内容

无。适配器把提供方回调转换为 `ChannelEnvelope` 记录，不添加 Prompt 分区或 Tool Schema。

#### Token 影响

零 Token；回调校验和投递决策都在 Host 上执行。

#### KV Cache 影响

无；适配器不组装提供方模型请求。

## Known Limitations and Deferred Work

- 本包只实现企业微信线格式合同；认证 Host 仍必须提供持久接纳、凭据解析、投递与提供方回执对账。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

# 渠道包

[English](README.md) | 中文

与提供方无关的企业渠道合同。[`channel-kernel`](channel-kernel/README.zh.md) 负责路由和可靠性决策；提供方适配器负责微信/企微登录、传输、持久入站/出站存储和回执。

当前 GA 支持的提供方适配器是 [`channel-wecom`](channel-wecom/README.zh.md)，只实现企业微信企业应用的线格式和安全合同，明确排除个人微信。HTTP 服务、PostgreSQL 入站／出站持久化、凭据、租约和实际投递仍由 Host 负责。

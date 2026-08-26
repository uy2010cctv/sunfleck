# identity/ — 共享身份

[English](README.md) | 中文

跨产品领域共享的匿名与已认证身份值。

| 包 | 职责 | ctx key |
|---|---|---|
| [`anonymous-user-id/`](anonymous-user-id/README.zh.md) | 为遥测、反馈和 DeepSeek 请求持久化一个限定于 Harness home 的匿名关联 id | — |
| [`enterprise-identity/`](enterprise-identity/README.zh.md) | 持久化组织、用户、角色、外部身份、会话、资源策略和审计 | — |
| [`enterprise-sso/`](enterprise-sso/README.zh.md) | 将本地、OIDC、SAML 和 LDAP 认证归一为企业身份 | — |
| [`enterprise-auth-web/`](enterprise-auth-web/README.zh.md) | 挂载登录路由、会话 Cookie、Host API 中央 RBAC 和管理端点 | `ctx.enterpriseSecurity` |

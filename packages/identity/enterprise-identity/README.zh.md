# `@deepseek-ai/dsh-enterprise-identity`

[English](README.md) | 中文

为组织、用户、角色、外部身份、哈希登录会话、资源策略和可归因审计记录提供 SQLite 持久化。不直接存储 Bearer Token 或密码。

`EnterpriseIdentityStore` 是 Host 使用的持久化契约。SQLite
`EnterpriseIdentityRepository` 只是其中一种实现；部署方可以注入事务型
PostgreSQL 实现，而不让认证逻辑依赖 SQLite 文件路径。

## Model Experience

### 身份持久化

#### What the model sees

无。`EnterpriseIdentityRepository` 是 Host-only 持久化，不贡献 Prompt、Message、Tool Schema、Result 或模型调用。

#### Token effect

零 Token。Repository 读写不进入模型历史。

#### KV Cache effect

无；身份持久化不组装提供方请求。

## Known Limitations and Deferred Work

- SQLite 是本地实现；企业 PostgreSQL 部署通过 `EnterpriseIdentityStore`
  组合边界使用独立的 `@deepseek-ai/dsh-enterprise-identity-postgres` 适配器。
  集群部署需要共享事务后端。
- 外部 IdP 和 LDAP 实时验证需要部署方提供的端点和证书。

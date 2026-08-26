# `@deepseek-ai/dsh-enterprise-identity-postgres`

[English](README.md) | 中文

为 DSH 企业组织、用户、角色、外部身份、哈希会话、资源策略、受管资产和可归因审计记录提供 PostgreSQL 持久化。SQLite 迁移命令会保留 ID，并在一个事务内导入所有控制面记录。

## Model Experience

### 身份持久化

#### What the model sees

无。该包属于 Host-only 持久化和迁移基础设施，不增加 Prompt、Message、Tool Schema、Result 或模型调用。

#### Token effect

零 Token。PostgreSQL 读写和迁移校验和不会进入模型历史。

#### KV Cache effect

无；该包不组装提供方请求。

## 迁移

先运行只读预检：

```sh
dsh-enterprise-identity-migrate --sqlite /path/identity.sqlite --database-url "$DSH_DATABASE_URL" --dry-run
```

然后移除 `--dry-run` 后运行相同命令。输出只包含行数和校验和；绝不打印密码、原始 Bearer Token 或连接字符串。

## Known Limitations and Deferred Work

- 该适配器是异步的；现有仅 SQLite 的调用方必须在企业 PostgreSQL 部署切换时显式完成组合。
- 生产 PostgreSQL/pgvector 上线仍需要部署方提供备份、TLS 和连接池配置。

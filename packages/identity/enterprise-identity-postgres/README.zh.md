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

然后仅在独立备份 PostgreSQL 目标后执行写入命令：

```sh
dsh-enterprise-identity-migrate --sqlite /path/identity.sqlite --backup /safe/identity.before-postgres.sqlite \
  --database-url "$DSH_DATABASE_URL" --target-backup-confirmed
```

`--backup` 为可选项；默认路径为 `<sqlite>.pre-postgres-migration.bak`。命令会在写入目标前检查 SQLite 完整性、复制数据库及 WAL 边车文件、取得迁移咨询锁并拒绝非空目标；导入后目标行数或校验和不一致会回滚。输出只包含行数和校验和；绝不打印密码、原始 Bearer Token、备份内容或连接字符串。

## Known Limitations and Deferred Work

- 该适配器是异步的；现有仅 SQLite 的调用方必须在企业 PostgreSQL 部署切换时显式完成组合。
- 生产 PostgreSQL/pgvector 上线仍需要部署方提供备份、TLS 和连接池配置。
- 驱动无关测试覆盖迁移安全性。真实 PostgreSQL 集成测试需要部署方提供 PostgreSQL 端点，暂缓执行。

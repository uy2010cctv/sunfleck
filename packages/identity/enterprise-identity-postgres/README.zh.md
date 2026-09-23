---
description: "PostgreSQL persistence and safe SQLite migration for DSH enterprise identity。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-identity-postgres`

[English](README.md) | 中文

## 概述

PostgreSQL persistence and safe SQLite migration for DSH enterprise identity。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

为 DSH 企业组织、用户、角色、外部身份、哈希会话、部门树、Workspace 授权、Session 绑定、已审核记忆以及免审核直写的私有 agent 与 pair 记忆分区、资源策略、受管资产和可归因审计记录提供 PostgreSQL 持久化。SQLite 迁移命令会保留 ID，并在一个事务内导入所有控制面记录。

## 迁移

先运行只读预检：

```sh
dsh-enterprise-identity-migrate --sqlite /path/identity.sqlite --database-url "$DSH_DATABASE_URL" --dry-run
```

然后仅在独立备份 PostgreSQL 目标后执行写入命令：

```sh
dsh-enterprise-identity-migrate --sqlite /path/identity.sqlite --backup /safe/identity.before-postgres.sqlite \
  --database-url "$DSH_DATABASE_URL" --source-quiesced --target-backup-confirmed
```

`--backup` 为可选项；默认路径为 `<sqlite>.pre-postgres-migration.bak`。写入模式前必须停止所有会写入源数据库的进程，然后通过 `--source-quiesced` 确认该状态。命令会在该静止源契约下检查 SQLite 完整性并复制数据库及 WAL 边车文件，随后取得迁移咨询锁并拒绝非空目标；导入后目标行数或校验和不一致会回滚。输出只包含行数和校验和；绝不打印密码、原始 Bearer Token、备份内容或连接字符串。

## Model Experience

### 身份持久化

#### What the model sees

无。该包属于 Host-only 持久化和迁移基础设施，不增加 Prompt、Message、Tool Schema、Result 或模型调用。

#### Token effect

零 Token。PostgreSQL 读写和迁移校验和不会进入模型历史。

#### KV Cache effect

无；该包不组装提供方请求。

## Known Limitations and Deferred Work

- 该适配器是异步的；现有仅 SQLite 的调用方必须在企业 PostgreSQL 部署切换时显式完成组合。
- 生产 PostgreSQL/pgvector 上线仍需要部署方提供备份、TLS 和连接池配置。
- 驱动无关迁移测试和可选的真实 PostgreSQL 集成测试覆盖部门、Workspace、Session 绑定与已审核记忆契约。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

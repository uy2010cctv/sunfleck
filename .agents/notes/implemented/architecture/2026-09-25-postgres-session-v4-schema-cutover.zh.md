# Agent Note: PostgreSQL Session V4 schema 隔离切换

Status: implemented

[English](2026-09-25-postgres-session-v4-schema-cutover.md) | 中文

## 问题

企业 PostgreSQL 存储中有已发布的 V0 和 V3 Session 行。V4 写入器会拒绝这些 Header；若原位替换这些行，旧发行版恢复时需要的前代数据也会丢失。

## 决策

企业配置通过 `DSH_ENTERPRISE_SESSION_V4_DATABASE_URL` 和 `databaseMode: standalone` 选择独立 PostgreSQL schema，原 schema 的历史行保持不变。运营者把一致的 PostgreSQL 快照导出为规范 JSONL 代际，由静态相邻迁移目录发布 V4 后继，再把验证通过的 V4 Header 与事件导入空 schema。导入器在切换前逐个重读 Session，对照 Header、继承事件数和完整事件列表。这把[已发布 Session 迁移决策](2026-08-31-released-session-format-migrations.zh.md)应用到企业 PostgreSQL 提供方，而不让提供方静默重释旧行。

## Alternatives considered

**原位更新现有行。** 拒绝，因为旧可执行文件会失去可读的 V0/V3 来源，迁移失败也可能留下无法精确回滚的混合表。

**把企业 Session 切到 JSONL 存储。** 拒绝，因为这会在事件格式之外，同时改变企业存储权威和运维备份路径。

## 影响

- 旧 schema 和数据库备份仍可供旧发行版使用；V4 schema 有独立的存储身份和 revision 空间。
- 新发行版启动前必须有完整的 V4 schema 和独立连接 URL。缺少配置会在启动时失败，不会向旧表写入新格式事件。
- 出现新 V4 写入后回滚，旧发行版不会看到这些新 Session。运营者保留 V4 schema，并恢复新发行版或先协调这些写入，才可把回滚视为数据完整。

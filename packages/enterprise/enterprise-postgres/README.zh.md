# `@deepseek-ai/dsh-enterprise-postgres`

[English](README.md) | 中文

DSH 企业版生产 PostgreSQL 组合包：维护一个有界 `pg.Pool`，启动时验证连接，并初始化身份、Session、员工目录、运营和 pgvector 知识库表；所有适配器共享事务感知数据库封装。

提供方不会将凭据、连接字符串或游标密钥写入 PostgreSQL 或 DSH Session 事件。部署方从 Secret Manager 提供 `connectionString` 和至少 32 字节且包含至少 8 个不同字节值的稳定 `cursorSigningKey`，并负责连接池大小、TLS、备份和数据库角色权限。企业 CLI Overlay 使用 HMAC-SHA256 和域标签 `dsh-enterprise-catalog/cursor-signing/v1` 从 `DSH_ENTERPRISE_MASTER_KEY` 派生游标密钥，不会将凭据加密密钥字节直接传给目录。

## 已知限制与暂缓事项

- 浏览器 Host API 仍需应用组合层暴露员工目录和运营方法，本包只提供持久服务。
- 旧 SQLite Session 日志迁移到 PostgreSQL 仍需独立的受控迁移操作。

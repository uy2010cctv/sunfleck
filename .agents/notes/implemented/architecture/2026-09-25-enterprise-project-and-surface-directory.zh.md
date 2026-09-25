# Agent Note: PostgreSQL 中的企业项目与协作面目录

Status: implemented

[English](2026-09-25-enterprise-project-and-surface-directory.md) | 中文

## 问题

企业 Web 控制器暴露项目与协作面路由，但生产组合没有提供 `enterpriseProjects` 或 `surfaces`，两个列表路由都返回 503。项目仓储已经使用 PostgreSQL；完整协作面运行时依赖同步的 SQLite 身份存储和员工账户服务，而企业部署使用 PostgreSQL 身份存储。

## 决策

企业 PostgreSQL 组合在身份迁移后迁移项目 schema，并提供完整的成员门禁 `enterpriseProjects` 服务。组合还维护带版本号、按组织隔离的 PostgreSQL 协作面目录，供 Web 列表读取。未挂载完整 `surfaces` 运行时时，只有通过既有 `channel.read` 授权与审计的 `GET /enterprise/surfaces` 可读取该目录。协作面创建、消息投递和渠道入站路由继续返回 `surface-plane-unavailable`；列表响应不代表这些能力已经挂载。

## Alternatives considered

**把 SQLite 协作面运行时挂到空的侧边数据库。** 拒绝，因为其中的员工和组织记录会与 PostgreSQL 身份数据分叉，权限或投递决定可能依据过期数据。

**无条件返回空列表。** 拒绝，因为这会隐藏存储失败，也无法区分没有已存协作面与事实源不可用。

## 影响

- 项目创建、列表、成员管理和归档共用一个 PostgreSQL 连接池和现有项目仓储。
- 协作面目录是只读投影；该组合尚无写入器，因此目录起初为空，直至 PostgreSQL 协作面运行时或显式导入器写入行。
- 未来的 PostgreSQL 协作面运行时必须一并负责员工账户、收件箱投递和目录写入，写入路由才能替换现有 503 响应。只要完整运行时已挂载，控制器就使用它。

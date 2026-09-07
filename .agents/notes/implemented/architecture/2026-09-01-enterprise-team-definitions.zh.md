# Agent Note：企业团队定义

Status: implemented

[English](2026-09-01-enterprise-team-definitions.md) | 中文

## 问题

固定团队记录支持当前工作台和调度目标，但其 leader、成员标签、Workflow 模板和审批 JSON 无法表达人类 owner、显式职责、章程完整性、证据验证或注意力限制。直接增加这些字段会让现有兼容记录与未来执行状态耦合，并迫使旧数据假装已有章程。

## 决策

`EnterpriseTeamDefinition` 是独立的 revision 控制平面记录。名册用可判别的人类 user 和不可变 Agent release 引用；角色独立于 actor 命名职责。验证策略记录 verifier、rubric reference 和高风险人类审核要求。注意力策略记录集中决策队列，以及可选的 open-decision 和 work-in-progress 限制，不编造 SLA。

定义使用 `needs-charter`、`draft`、`active` 和终态 `archived`。每次保存草稿都会归档前一份草稿并追加下一条不可变修订，绝不修改 active 投影。发布会校验一条准确草稿修订、归档原 active 修订、提升该草稿，并原子刷新 active 兼容投影。丢弃只归档选定草稿。Archive 会在同一事务中封存所有 active 或 draft 修订及 active 兼容投影，已归档团队无法重新发布。Active 校验要求非空名称与 north star、已入队的人类 owner、已入队的 Agent leader、唯一 role 与 actor、有效 role 引用、完整的验证与注意力字段，以及 restricted 可见性所需的非空、已 trim、唯一 allowlist。Organization 和 private 定义不携带 allowlist。

PostgreSQL 表只存储章程、名册、策略、可见性、revision 和生命周期字段。TeamRun 与其他 runtime 状态不属于此表。FixedTeam 和定义写入及团队 admission 共用同一全局 team-id advisory lock。Needs-charter 旧 save 同步 Agent 投影。Active 与 archived 兼容判定只比较已持久 FixedTeam execution fields，不反向投影 formal roles 或 typed approval policy；active 允许仅 Workflow 变更，archived 只允许精确 no-op。Worker admission 用短事务复验 processing lease 与 active 定义，记录持久 start marker，再在外部 Session callback 前释放连接。

迁移和固定团队创建会在定义缺失时插入一条 `needs-charter` 定义。它们保留 team id、组织可见性、不可变 leader release、成员 release 引用、角色标签、审批策略和时间戳。无已记录 owner 时，bootstrap 使用 `system:legacy-fixed-team-migration`，并保持名称、north star、职责、验证策略和注意力策略为空。重复迁移保持幂等，团队工作记录和调度入口在启动工作前调用执行 validator。

生成的 `enterpriseTeamDefinition` Remote namespace 提供 list、get、getDraft、draft、publish、discardDraft 和 archive；`save` 作为兼容别名保留，但只创建草稿，不会替换 active 章程。`getDraft` 只向其负责人或管理员返回当前草稿，active 目录绝不以草稿历史替换内容。浏览器请求包含写入防护和定义字段，但不包含组织或 actor 字段；Host request context 提供 principal，现有 `team.read` 与 `team.manage` 策略及审计链路保护每项操作。Host 只派生 user id 和管理员状态；PostgreSQL 在 keyset 分页前执行 organization、private、owner 和 restricted 可见性，并将该 scope 绑定到 cursor。Active 写入在组织内解析每个人类和可选部门，并在幂等摘要与存储前 canonicalize restricted allowlist。

Active Definition 写入会将 leader、带 formal role ID 的非 leader Agent 成员和 approval policy 投影到 FixedTeam，同时保留 Workflow template。新 team work 必须指定 active 名册中的 Agent release。每条 team outbox command 记录 active Definition revision；admission 拒绝过期 revision 或非当前 leader 的 release。全局 team-id 锁与现有全局主键一致，并将跨组织冲突稳定表达为 conflict。

## 考虑过的替代方案

**扩展固定团队记录。** 拒绝，因为当前工作台和调度依赖其较小的兼容记录，而旧记录没有可如实填充的章程内容。

**在定义中同时增加 TeamRun。** 拒绝，因为执行需要独立的生命周期、证据、审批和恢复决策；将部分 runtime 状态存入章程表会建立错误的持久化所有者。

## 影响

- 在设计执行编排之前，人类与 Agent 成员关系已有唯一类型化表达。
- 旧记录可见，但不编造章程内容，必须显式补全章程才能转为 active。
- FixedTeam CRUD 和 UI payload 保持兼容，团队执行需要 active 定义。
- 编辑章程使 active TeamRun 始终保留稳定的历史修订，代价是保存归档修订行。
- 工作台会先保存草稿，再执行独立发布动作；打开或保存编辑器不会修改 active 章程。
- 定义目录只向草稿负责人或管理员显示当前草稿；启动选择器会在发布前将其排除。
- 独立的[企业团队控制面](2026-09-01-enterprise-team-control-plane.zh.md)负责 TeamRun 投影与 runtime-driver 接口；[团队章程编辑器](../../../docs/superpowers/plans/2026-09-05-team-charter-editor.md)负责浏览器编写，具体 Agent Teams adapter 和提供方投递仍是独立工作。

## 验证

定向 Vitest 覆盖 active 校验、旧数据迁移、CRUD、组织隔离、CAS、幂等、归档终态、principal 注入、RBAC 决策、审计调用和稳定 Remote 错误。配置 `DSH_TEST_POSTGRES_URL` 时，PostgreSQL 集成套件负责 schema、迁移与 CAS 覆盖。根目录 typecheck 在编译 Client 图之前构建 Host declaration 和生成的 Typert client。

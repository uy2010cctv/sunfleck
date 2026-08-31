# Agent Note：企业团队定义

Status: implemented

[English](2026-09-01-enterprise-team-definitions.md) | 中文

## 问题

固定团队记录支持当前工作台和调度目标，但其 leader、成员标签、Workflow 模板和审批 JSON 无法表达人类 owner、显式职责、章程完整性、证据验证或注意力限制。直接增加这些字段会让现有兼容记录与未来执行状态耦合，并迫使旧数据假装已有章程。

## 决策

`EnterpriseTeamDefinition` 是独立的 revision 控制平面记录。名册用可判别的人类 user 和不可变 Agent release 引用；角色独立于 actor 命名职责。验证策略记录 verifier、rubric reference 和高风险人类审核要求。注意力策略记录集中决策队列，以及可选的 open-decision 和 work-in-progress 限制，不编造 SLA。

定义使用 `needs-charter`、`active` 和终态 `archived`。Active 校验要求非空名称与 north star、已入队的人类 owner、已入队的 Agent leader、唯一 role 与 actor、有效 role 引用、完整的验证与注意力字段，以及 restricted 可见性所需的非空、已 trim、唯一 allowlist。Organization 和 private 定义不携带 allowlist。只有 archive 可进入终态，之后的每次 save 都被拒绝。

PostgreSQL 表只存储章程、名册、策略、可见性、revision 和生命周期字段。TeamRun 与其他 runtime 状态不属于此表。FixedTeam 和定义写入及团队 admission 共用同一组织/团队 advisory lock。Needs-charter 旧 save 同步 Agent 投影；active 定义允许精确 no-op 和仅 Workflow 变更，archived 定义只允许精确 no-op。Worker admission 用短事务复验 processing lease 与 active 定义，记录持久 start marker，再在外部 Session callback 前释放连接。

迁移和固定团队创建会在定义缺失时插入一条 `needs-charter` 定义。它们保留 team id、组织可见性、不可变 leader release、成员 release 引用、角色标签、审批策略和时间戳。无已记录 owner 时，bootstrap 使用 `system:legacy-fixed-team-migration`，并保持名称、north star、职责、验证策略和注意力策略为空。重复迁移保持幂等，团队工作记录和调度入口在启动工作前调用执行 validator。

生成的 `enterpriseTeamDefinition` Remote namespace 提供 list、get、save 和 archive。浏览器请求包含写入防护和定义字段，但不包含组织或 actor 字段；Host request context 提供 principal，现有 `team.read` 与 `team.manage` 策略及审计链路保护每项操作。Host 只派生 user id 和管理员状态；PostgreSQL 在 keyset 分页前执行 organization、private、owner 和 restricted 可见性，并将该 scope 绑定到 cursor。Active 写入在组织内解析每个人类和可选部门，并在幂等摘要与存储前 canonicalize restricted allowlist。

## 考虑过的替代方案

**扩展固定团队记录。** 拒绝，因为当前工作台和调度依赖其较小的兼容记录，而旧记录没有可如实填充的章程内容。

**在定义中同时增加 TeamRun。** 拒绝，因为执行需要独立的生命周期、证据、审批和恢复决策；将部分 runtime 状态存入章程表会建立错误的持久化所有者。

## 影响

- 在设计执行编排之前，人类与 Agent 成员关系已有唯一类型化表达。
- 旧记录可见，但不编造章程内容，必须显式补全章程才能转为 active。
- FixedTeam CRUD 和 UI payload 保持兼容，团队执行需要 active 定义。
- TeamRun、浏览器编辑和 Agent runtime 协作仍延期，不能由定义的存在推断已交付。

## 验证

定向 Vitest 覆盖 active 校验、旧数据迁移、CRUD、组织隔离、CAS、幂等、归档终态、principal 注入、RBAC 决策、审计调用和稳定 Remote 错误。配置 `DSH_TEST_POSTGRES_URL` 时，PostgreSQL 集成套件负责 schema、迁移与 CAS 覆盖。根目录 typecheck 在编译 Client 图之前构建 Host declaration 和生成的 Typert client。

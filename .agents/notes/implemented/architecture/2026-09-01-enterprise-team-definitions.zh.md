# Agent Note：企业团队定义

Status: implemented

[English](2026-09-01-enterprise-team-definitions.md) | 中文

## 问题

固定团队记录支持当前工作台和调度目标，但其 leader、成员标签、Workflow 模板和审批 JSON 无法表达人类 owner、显式职责、章程完整性、证据验证或注意力限制。直接增加这些字段会让现有兼容记录与未来执行状态耦合，并迫使旧数据假装已有章程。

## 决策

`EnterpriseTeamDefinition` 是独立的 revision 控制平面记录。名册用可判别的人类 user 和不可变 Agent release 引用；角色独立于 actor 命名职责。验证策略记录 verifier、rubric reference 和高风险人类审核要求。注意力策略记录集中决策队列，以及可选的 open-decision 和 work-in-progress 限制，不编造 SLA。

定义使用 `needs-charter`、`active` 和终态 `archived`。Active 校验要求非空名称与 north star、已入队的人类 owner、已入队的 Agent leader、唯一 role 与 actor、有效 role 引用、仅 restricted 允许的用户列表，以及完整的验证与注意力字段。导出的执行 validator 拒绝所有非 active 定义。

PostgreSQL 表只存储章程、名册、策略、可见性、revision 和生命周期字段。TeamRun 与其他 runtime 状态不属于此表。写入使用组织范围查询、compare-and-swap revision 和绑定请求摘要的幂等；列表使用现有签名的组织绑定 keyset cursor。

迁移为每个缺少定义的固定团队插入一条 `needs-charter` 定义。它保留 team id、组织可见性、不可变 leader release、成员 release 引用、角色标签、审批策略和时间戳。无已记录 owner 时，迁移使用 `system:legacy-fixed-team-migration`，并保持名称、north star、职责、验证策略和注意力策略为空。重复迁移保持幂等，且该不完整记录无法通过 active 或执行校验。

生成的 `enterpriseTeamDefinition` Remote namespace 提供 list、get、save 和 archive。浏览器请求包含写入防护和定义字段，但不包含组织或 actor 字段；Host request context 提供 principal，现有 `team.read` 与 `team.manage` 策略及审计链路保护每项操作。旧 `enterpriseTeam` namespace 和固定团队 repository 继续为当前工作台提供能力。

## 考虑过的替代方案

**扩展固定团队记录。** 拒绝，因为当前工作台和调度依赖其较小的兼容记录，而旧记录没有可如实填充的章程内容。

**在定义中同时增加 TeamRun。** 拒绝，因为执行需要独立的生命周期、证据、审批和恢复决策；将部分 runtime 状态存入章程表会建立错误的持久化所有者。

## 影响

- 在设计执行编排之前，人类与 Agent 成员关系已有唯一类型化表达。
- 旧记录可见，但不编造章程内容，必须显式补全章程才能转为 active。
- FixedTeam UI 和调度行为保持兼容，Client 可独立迁移到新 namespace。
- TeamRun、浏览器编辑和 Agent runtime 协作仍延期，不能由定义的存在推断已交付。

## 验证

定向 Vitest 覆盖 active 校验、旧数据迁移、CRUD、组织隔离、CAS、幂等、归档终态、principal 注入、RBAC 决策、审计调用和稳定 Remote 错误。配置 `DSH_TEST_POSTGRES_URL` 时，PostgreSQL 集成套件负责 schema、迁移与 CAS 覆盖。根目录 typecheck 在编译 Client 图之前构建 Host declaration 和生成的 Typert client。

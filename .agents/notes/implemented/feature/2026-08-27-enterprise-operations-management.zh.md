# Agent Note: 组织范围的 Operations 管理能力

Status: implemented

[English](2026-08-27-enterprise-operations-management.md) | 中文

## Problem

持久化 Operations 投影可以创建工作记录、审批、调度和固定团队，但管理端无法稳定分页或过滤，也无法使用 compare-and-swap 编辑团队和调度、取消 pending 审批。生产组合也没有接入原生发布版和 Session 引用校验。Offset 分页或无签名 cursor 会在数据变动时不稳定，并可能混淆不同组织的查询 scope。

## Decision

Operations Repository 承担组织范围的 keyset 查询和 CAS 写入。不透明 cursor 由 canonical base64url 载荷和 HMAC-SHA256 签名组成，scope digest 绑定实体类型、组织和全部过滤条件。工作记录按 `updated_at DESC, session_id DESC, employee_release_id DESC` 排序；审批、调度和团队按 `updated_at DESC` 加稳定 ID 排序。Limit 只允许 1 至 100 的整数。

工作记录支持业务状态、来源和团队过滤；审批支持类型、状态和申请人过滤；调度支持状态过滤。Pending 审批可转为 `cancelled`，并持久化 actor 和可选 reason。Service 边界仅允许原申请人或管理员取消。固定团队保存会校验负责人和所有成员发布版的组织归属，然后原子替换完整成员集合。调度保存在 revision CAS 下替换 target、timezone、rule、input 和 next-run time。已归档调度保持终态。

生产组合从部署密钥派生相互隔离的 Catalog 和 Operations cursor key。发布版 resolver 检查 `dsh_enterprise_employee_releases(release_id, org_id)`。Session resolver 将 `dsh_session_headers(id)` 与 `resource_policies(resource_type = 'session', resource_id, org_id)` 连接，缺失 policy 或跨组织 policy 都失败关闭；工作记录的组织归属仍由 Operations Repository 强制。取消操作在授权决策前先解析审批申请人，非申请人且非管理员时只记录 denied 审计。带过滤的调度 Service 调用返回 cursor page，无过滤重载保留旧数组。不带 request digest 的旧幂等 envelope 会失败关闭。Schema v5 增加分页和过滤索引。

## Alternatives considered

- **Offset 分页** — 实现简单，但两次请求之间的插入或更新可导致重复或遗漏记录。
- **无签名 JSON cursor** — 可读，但调用方可篡改组织、过滤条件或排序键。签名的不透明 cursor 能在 scope 变更时失败关闭。
- **共用一个派生 cursor key** — 运维简单，但一个 Repository 的 key 泄露后可为另一个 Repository 的 cursor 签名。域隔离派生缩小了影响范围。
- **单独 patch 团队成员** — 减少写入量，但会引入部分成员语义和更多 CAS 表面。整体替换保持单一原子团队 revision。
- **允许恢复已归档调度** — 操作方便，但会破坏归档作为审计终态的含义。恢复行为应由新调度表达。

## Verification

Repository 和 Service 测试覆盖 cursor limit 与查询 scope 拒绝、过滤、调度 page 转发、取消授权与仅 denied 审计、CAS 更新、成员替换和已归档调度不可变性。真实 PostgreSQL 测试覆盖分页与过滤、取消、团队 CAS 替换、Session policy 缺失/跨组织/匹配三种情况，以及选用 `dsh_enterprise_work_records_page_idx` 的 `EXPLAIN` 计划；`SET LOCAL enable_seqscan = off` 与 `EXPLAIN` 在同一个事务 client 上执行。

## Consequences

管理查询在数据并发变化时仍保持稳定，并在组织或过滤 scope 不匹配时失败关闭。生产写入现在要求原生引用已存在。代价是需要部署所有的 cursor 密钥材料、额外索引、keyset 专用查询代码，以及每次团队编辑都整体替换成员。过滤条件变更或 key 轮换后，cursor 会按设计失效。

# 协作形态 P2 实施计划（群聊两档 / 频道 / 项目实体）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 四种交互形态全量落地——群聊两档（联邦式 @路由 / 章程团队 Lead 入口）、频道（话题分区 + 当值路由 + 公告进水口）、项目一等实体（成员制治理 + Workspace 绑定）；验收：有章程群从渠道一条消息跑通 Lead→Doer→Verifier→决策回流；值班频道 @ 与当值两条路由可达且话题落定可审计。

**Architecture:** 渠道内核 `routeInbound` 是零消费者纯函数（决策序 命令→sticky→intent→default），P2 补生产消费管道；`EnterpriseSecurity`/团队运行时已具备幂等 startRun + 确定性根 session + active-run 查询，只缺 `source:'channel'` 调用方与一个公开的 run 注入方法（附加式）；schedules 包无当值查询 API（deliveryMode 封闭 session-local），**频道当值改为 surface 级值班名册**（deviation，见 D2）；项目按 spec §10 落 PostgreSQL 新包 `enterprise-project`；记忆 L3 只做项目隔间（memory 表加 `project_id` 列），团队/群隔间记入 P3（deviation，见 D3）。设计依据 [spec §6/§10/§12-P2](../specs/2026-09-22-persistent-digital-employee-design.md)。

**已定偏差决策（评审时已确认方向，落地时不再重开）：**
- **D1** 章程群不走 Lead 的 employee_inbox：TeamRun 根 session 就是 Lead 的协调面，渠道消息经运行时新公开方法直接注入 run（幂等 startRun 已有），inbox 语义保持 dm 专属。
- **D2** 频道当值 = surface 上的有序 `duty_employee_ids`（P2 静态名册）；schedules 集成（时间窗轮换）延期并记录——schedules 无 org 级定义与查询 API，属新机制。
- **D3** 记忆 L3 本期只做项目隔间（`project_id` 列 + 授权召回）；团队/群隔间（跨 run 记忆）随 P3 consolidation 一起做。
- **D4** 公告（ingest-only）进水口 = 直接入 `proposeMemory`（截断摘要 + 隐私门，proposed 等人审）；LLM 抽取式公告整理随 P3。
- **D5** 渠道入站 HTTP 端点接收**已规范化 envelope** + 部署侧认证钩子（configuration readiness）；WeCom 加解密回调接线属部署证据（wecom 测试基建已有伪造加密报文能力，供后续接入复用）。

**Tech Stack / 铁律：** 同 P0/P1（strict TS、Cordis、vitest 100% 覆盖、双语文档、单尾换行、无关脏文件绝不入库、oxlint 文件列表、notices hook --no-verify 留证）。分支 `sunfleck/employee-surfaces-p2`。

---

## 文件结构

```
packages/identity/enterprise-identity/
  src/schema.ts                        # v8：surfaces kind/列扩展 + channel_topics + memories.project_id
  src/employee-store.ts                # 群/频道面 API、话题 CRUD、当值存取
  src/repository.ts                    # memory project_id（Entry/过滤）
  tests/…
packages/identity/enterprise-identity-postgres/
  src/schema.ts + migration.ts         # v7：memories.project_id
  src/repository.ts
packages/enterprise/enterprise-surface/
  src/dm.ts / src/group.ts / src/channel.ts / src/index.ts / src/types.ts
  tests/…
packages/experimental/enterprise-team-runtime/src/index.ts   # 附加：deliverToRun（D1）
packages/enterprise/enterprise-project/                      # 新包（PG 项目治理）
  package.json tsconfig.json README×3 src/{index,types,service}.ts tests/
packages/api/enterprise-controller/src/employee-http.ts + index.ts + tests   # surfaces/projects 端点 + 渠道入站
packages/client/ui-enterprise-workbench/src/client/*  # 项目空间 + surfaces 名册
.agents/notes/implemented/feature/2026-09-26-employee-surfaces-p2.* 
```

---

### Task 1: 协作面存储（identity SQLite v8 + PG v7）

- [ ] **失败测试**：v8 迁移后——surfaces `kind` 接受 'group'|'channel'；新列 `team_definition_id`/`project_id`/`external_key`/`name`/`topic_policy`/`respond_policy`/`duty_employee_ids`（TEXT, 可空；duty 存 JSON 数组）；`(org_id, kind, external_key)` 上部分唯一索引（external_key 非空时唯一）；`channel_topics` 表（topic_id PK, surface_id FK, title, state CHECK open/settled/archived, session_id?, created_by, created_at, settled_at?）；`enterprise_memories.project_id TEXT` 可空（两库）。v7→v8 / v6→v7 数据保留。
- [ ] **实现**：版本门分支加 `|| === 7`（SQLite，沿用增量注释模式）；employee-store 新 API——`ensureGroupSurface`/`ensureChannelSurface`（键 (org_id, kind, external_key) 幂等；dm 的 ensureSurface 不动）、`setGroupMembers`/`groupMembers`（新表 `surface_members(surface_id, principal_type CHECK user/employee, principal_id, role_id?, PRIMARY KEY(surface_id, principal_type, principal_id))`）、`ensureTopic(surfaceId, title, createdBy, policy)`（thread/command 策略下首个话题由调用方判定）、`settleTopic(topicId, at)`、`topicsBySurface(surfaceId)`、`topicBySession(sessionId)`、`setDutyRoster(surfaceId, employeeIds)`；memory：`EnterpriseMemoryEntry.projectId?`、`proposeMemory/writePrivateMemory/listMemories` 透传 `projectId` 过滤（双库 + 共享 helper 扩展）。
- [ ] **测试**：两库平行（迁移保留、唯一索引、成员表、话题生命周期、project_id 过滤）。
- [ ] **Commit**：`feat(enterprise): store collaboration surfaces, topics, and project memory scope`

### Task 2: 项目实体包 enterprise-project

- [ ] **新包**（形态照 employee-account/enterprise-project 计划 §11；PG 自带版本化 schema v1）：`projects(project_id PK, org_id FK organizations, name, goal, workspace_path, team_definition_id?, state CHECK active/archived, visibility CHECK organization/private/restricted, allowed_user_ids TEXT, created_by, created_at, archived_at?)`；`project_members(project_id, principal_type, principal_id, added_by, added_at, PK 三元)`。
- [ ] **服务** `ctx.enterpriseProjects`：`create({orgId,name,goal,workspacePath,createdBy,teamDefinitionId?})`（创建即 active；workspace 绑定延到消费方用 workspaceRegistry.ensure + attach——服务只存路径）、`get/list(orgId, principal?)`（visibility 三档 + allowed_user_ids 过滤）、`addMember/removeMember/listMembers`、`archive(projectId)`（终态，隔间记忆转只读是 P3 语义，本期只锁状态）、`requireMember(orgId, projectId, principal): Project | undefined`（跨组织/非成员统一 undefined，不泄露存在性）。
- [ ] **测试**：PG 单测 + 集成（沿用 skip 约定）；服务全方法 + 授权矩阵（非成员/跨组织/visibility 组合）。
- [ ] **Commit**：`feat(enterprise): add the project governance entity`

### Task 3: 群聊两档 + 团队运行时注入

- [ ] **运行时附加方法**（enterprise-team-runtime）：`submitRunInput(runId, input: {actorUserId, text, originSurfaceId}): Promise<SubmissionReceipt>`——经 root followup 注入（:219-224 既有路径），消息 source 用 merge-extensible `team-run-message`（复用 P0 surface-message 的 MessageSourceMap 模式，带 originSurfaceId/actorUserId）；run 不存在 → 结构化错误。+ 单测。
- [ ] **群送达**（enterprise-surface 新 group.ts）：`ensureGroupSurface({orgId, name, externalKey?, memberEmployeeIds, teamDefinitionId?, projectId?})`——联邦式（无章程）：为每个成员员工建/复用 per-employee anchored session（键 (surface, employee) 新表 `surface_sessions(surface_id, employee_id, session_id, PK二元)`——dm 的 surfaces.session_id 语义保留）；团队式（有 teamDefinitionId）：解析章程 Lead（经 teamControl/operations 读 API，只读），不建成员 session。`deliverToGroup(surface, {originUserId, text, mentionedEmployeeIds?})`：团队式 → 解析 active run（teamControl.listTeamRuns state 'active'）→ `submitRunInput`，无 active → `startRun({source:'channel', idempotencyKey: `${surface.id}:${originUserId}`, ...charter})` 后注入（幂等可重试）；联邦式 → @提及的员工（显式 mentioned 或按 displayName 匹配，无匹配 → 不投递并返回结构化 no-target）逐个 steer 其群 session（绕过 employee_inbox，D1 已定 inbox 为 dm 专属；JSDoc 记录）。
- [ ] **测试**：fake host/teamControl 桩——两档路由、@无匹配 no-target、团队式 attach-vs-new-run（active run 存在时不新建）、成员 session 复用、项目面挂 project_id。
- [ ] **Commit**：`feat(enterprise): deliver group messages in federated and chartered modes`

### Task 4: 频道（话题 / 当值 / 公告）

- [ ] **channel.ts**：`ensureChannelSurface({orgId, name, externalKey?, topicPolicy:'thread'|'command', respondPolicy:'mention_duty'|'ingest_only', dutyEmployeeIds, projectId?})`；`deliverToChannel(surface, {originUserId, text, mentionedEmployeeIds?})` 路由——`/topic 标题` 开话题（command 策略）；提及解析：@员工 → 该员工话题 session（懒建，键 (topic, employee)——话题 per-employee session 或单 session？**定：话题 session 唯一**，由首个被路由员工的 anchored 身份创建，后续 @ 其他员工时经 mailbox steer 该 session 并 @ 标注——避免话题碎片化）；未 @ → 当值 = duty_employee_ids[0]（P2 静态名册，D2）；`respond_policy='ingest_only'` → 不建回合，摘要入 `proposeMemory`（organization scope，proposed，D4）；`/done` → settleTopic + steer 话题 session 落定（可审计：store 状态 + 会话事件双留痕）。
- [ ] **测试**：话题创建两策略、@路由、当值兜底、ingest_only 入 proposed、/done 落定断言（store 状态 + session 事件）、ingest_only 不产生 agent 回合。
- [ ] **Commit**：`feat(enterprise): route channel topics with duty and announcement intake`

### Task 5: 控制器端点

- [ ] **端点**（employee-http.ts 旁新文件 surfaces-http.ts 或并入，认证/授权/审计沿既有 seam）：`POST /enterprise/surfaces/groups|channels`（创建，body 带成员/当值/章程/项目引用）、`GET /enterprise/surfaces?kind=`、`POST /enterprise/surfaces/:id/messages`（body {text, mentionedEmployeeIds?} → deliverToGroup/deliverToChannel；409 no-target？定：200 + `{delivered:false, reason:'no-target'}`）、`POST /enterprise/surfaces/:id/topics/:topicId/settle`、`POST /enterprise/projects`、`GET /enterprise/projects`、`POST /enterprise/projects/:id/members`、`POST /enterprise/projects/:id/archive`、`POST /enterprise/channels/:channelId/inbound`（D5：已规范化 envelope + `x-dsh-channel-token` 部署侧令牌比对，配置缺失 → 503 configuration-required）；错误映射沿既有表（404 折叠/409/400）。
- [ ] **测试**：每端点 happy/401/403/404/400/409；入站令牌缺失 503。
- [ ] **Commit**：`feat(enterprise): expose collaboration surfaces and projects on the controller`

### Task 6: 工作台项目空间

- [ ] **store + 视图**：`projects` 切片（list/create/members/archive）+ 项目空间页（按原型 2 简化形态：成员头像行、项目记忆计数区、待决占位、归档按钮——工作记录/文件页签 P2 只做占位空态文案）；surfaces 名册最小列表（kind/name/成员数）。全部文案进字典双语；i18n 门禁绿。
- [ ] **测试**：store actions + 视图渲染断言（照 staff/employees 既有模式）。
- [ ] **Commit**：`feat(workbench): add the project space and surface roster`

### Task 7: 验收 + Agent Note + 收尾

- [ ] **e2e**（fake host + 真仓库）：① 章程群：渠道 envelope → Lead → startRun(source='channel') → 团队决策回流断言（decision 队列出现、respondDecision 可答）；② 频道：@话题路由 + 当值兜底两路径、/done 落定（store + session 事件双留痕）；③ ingest_only 公告 → proposed 组织记忆；④ 项目会话的 L3：project_id 记忆只对该项目会话注入。
- [ ] **快照**：群/频道消息产生新的模型可见 source（team-run-message/surface-message 扩展）→ 按 P1 模式：无 DEEPSEEK_API_KEY 则 owner-local 记录写进 Agent Note。
- [ ] **验证清单**：typecheck 0；八包 scoped vitest 全绿；test:docs 失败逐条归类（ours=0）；oxlint 全量分支文件 0；duplication 仅既有 27 克隆。
- [ ] **Agent Note 三件套** `2026-09-26-employee-surfaces-p2.*`：含 D1-D5 偏差决策、schedules 集成延期、WeCom 回调接线属部署证据、入站令牌 configuration readiness。
- [ ] **Commit**：`test(enterprise): verify chartered group and channel routing end to end`

---

## Self-Review 记录

- Spec 覆盖：§12 P2 验收两条 ↔ Task 3（章程群）+ Task 4/7（频道）；§6.1 五形态 ↔ dm(P0)+group/channel(Task 3/4)+project(Task 2/6)；团队隔间延期 D3、当值名册 D2 已显式记录。
- 类型一致：Surface 类型扩展单点（enterprise-surface types.ts）；`submitRunInput`/`deliverToGroup`/`deliverToChannel` 签名在 Task 3/4 定义后 Task 5/6 只消费；memory `projectId` 在 Task 1 定义。
- 占位符：无 TBD；D1-D5 是已定偏差不是待定项。

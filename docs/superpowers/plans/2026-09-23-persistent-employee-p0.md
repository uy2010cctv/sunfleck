# 持久化数字员工 P0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让数字员工获得持久身份——EmployeeAccount / 收件箱 / sticky 绑定的持久层与服务、Web 私聊投递桥、企业端点与员工详情基础视图；验收路径：向员工发一条私聊消息 → 员工 anchored session 产生回合 → 全链路可从 Session 日志回放。

**Architecture:** 存储放企业身份 SQLite（schema v6 增量迁移，与多组织引导同事务域）；服务以新包 `dsh-employee-account` 暴露 `ctx.employeeAccounts`；投递桥在新包 `dsh-enterprise-surface`，会话创建复用 `packages/webhook/webhook/src/session.ts` 的 workspace→session 模板；企业端点挂在 `enterprise-controller` 既有企业安全覆盖之后。设计依据 [spec](../specs/2026-09-22-persistent-digital-employee-design.md)（P0 范围 = spec §12 P0 行）。

**Tech Stack:** TypeScript strict + ESM、`node:sqlite`（STRICT 表）、Cordis 插件（`ctx.effect()` 注册）、vitest（覆盖率门禁 100% per-file）、oxlint、双语文档门禁。

**仓库铁律（每个任务的执行者都必须遵守）：**
- 新行为走插件注册（`ctx.effect()`），不改 agent-loop；不新增 `SessionEventMap` 成员（P0 私聊消息就是 `user/message`，格式版本不动）。
- 跨边界 id 用 `Branded<B>`（`@deepseek-ai/dsh-brand`）：`EmployeeId`、`SurfaceId`、`InboxItemId` 在 `employee-account/src/ids.ts` 定义一次，全链路复用。
- 每个 export 有 JSDoc（`@param`/`@returns`）；空 `catch` 必须注释吞掉什么、为什么。
- 文件结尾恰好一个换行；`pnpm run typecheck` 与新增文件的 vitest 必须绿。
- 测试不做 `any` 逃逸；信任 TypeScript 同进程边界，只在 SQLite 行解析处做运行时校验。
- 明确 > 隐式：默认值放在 owner 的 `resolve()` 步骤，不藏在 `run()` 里。

---

## 文件结构

```
packages/identity/enterprise-identity/
  src/schema.ts                      # 修改：v6 迁移（4 张新表，加法式）
  src/employee-store.ts              # 新建：三张表的行读写（唯一触碰 SQL 的文件）
  tests/employee-store.spec.ts       # 新建
packages/enterprise/employee-account/
  package.json  tsconfig.json  tsdown.config.ts
  README.md  README.zh.md  README.i18n.yaml
  src/index.ts                       # 插件入口：注册 ctx.employeeAccounts
  src/ids.ts                         # EmployeeId / SurfaceId / InboxItemId（Branded）
  src/types.ts                       # 领域类型与 Service 接口
  src/service.ts                     # Service 实现（组织域校验 + 生命周期状态机）
  src/invariant.ts                   # 仅当出现独立可发散观测才创建；否则省略并在 README Dev Note 记录原因
  tests/service.spec.ts
packages/enterprise/enterprise-surface/
  package.json  tsconfig.json  tsdown.config.ts  README.md  README.zh.md  README.i18n.yaml
  src/index.ts                       # 插件入口：注册 ctx.surfaces
  src/types.ts                       # Surface / InboundMessage 类型与接口
  src/dm.ts                          # ensureDm + deliverToEmployee（桥核心）
  tests/dm.spec.ts
packages/api/enterprise-controller/
  src/employee-http.ts               # 新建：4 个端点
  src/index.ts                       # 修改：挂载 employee-http
  tests/employee-http.spec.ts        # 新建（复用 recorder-binding-http.spec.ts 的 harness）
packages/client/ui-enterprise-workbench/
  src/client/employees.ts            # 新建：员工详情 + 私聊输入的节点渲染
  src/client/store.ts                # 修改：employees 状态切片
  src/client/locales.ts              # 修改：en/zh 文案字典（verify-client-ui-i18n 门禁）
  tests/employees.client.spec.ts     # 新建
```

依赖方向：`enterprise-surface` → `employee-account` → `enterprise-identity`；`enterprise-controller`、`ui-enterprise-workbench` 消费 `employee-account`。禁止反向 import。

---

### Task 1: SQLite schema v6 —— 四张新表

**Files:**
- Modify: `packages/identity/enterprise-identity/src/schema.ts`
- Test: `packages/identity/enterprise-identity/tests/schema.spec.ts`（已存在则追加用例）

- [ ] **Step 1: 写失败测试**——v6 迁移后四张表存在，且以 v5 库文件重开再迁移不丢数据：

```ts
it('migrates v5 schema to v6 keeping existing organizations', () => {
  const database = new DatabaseSync(':memory:')
  migrateEnterpriseIdentityV5ForTest(database)          // 既有导出或临时构造 v5 数据
  database.exec("INSERT INTO organizations (id, name) VALUES ('org-1', 'Acme')")
  migrateEnterpriseIdentity(database)
  const row = database.prepare(
    "SELECT count(*) AS n FROM employee_accounts WHERE org_id = 'org-1'",
  ).get()
  assert.equal(row.n, 0)                                // 新表可查询即证明迁移成功
})
```

- [ ] **Step 2: 运行确认失败**：`pnpm vitest run packages/identity/enterprise-identity/tests/schema.spec.ts` → FAIL（无 `employee_accounts` 表）。
- [ ] **Step 3: 实现**——`ENTERPRISE_IDENTITY_SCHEMA_VERSION` 5→6，`migrateEnterpriseIdentity` 内追加（保持 STRICT、外键、加法式，不改动既有表）：

```sql
CREATE TABLE IF NOT EXISTS employee_accounts (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  role_card TEXT NOT NULL,
  active_release_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('active','suspended','archived')),
  home_workspace_path TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS surfaces (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('dm')),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employee_accounts(id) ON DELETE CASCADE,
  session_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, employee_id)
) STRICT;
CREATE TABLE IF NOT EXISTS employee_inbox (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employee_accounts(id) ON DELETE CASCADE,
  surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE,
  origin_actor TEXT NOT NULL,
  payload_text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS employee_inbox_pending
  ON employee_inbox(employee_id, state, created_at);
CREATE TABLE IF NOT EXISTS sticky_bindings (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  employee_id TEXT NOT NULL REFERENCES employee_accounts(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(org_id, actor_key)
) STRICT;
```

P0 的 `surfaces.kind` 收窄为 `'dm'`（CHECK 白名单，P2 加 group/channel/project 时扩 CHECK——加法式迁移与 §10 一致）。

- [ ] **Step 4: 跑测试确认通过**；`pnpm run typecheck` 绿。
- [ ] **Step 5: Commit**：`feat(enterprise): persist employee accounts, inbox, and sticky bindings`

---

### Task 2: 行读写 employee-store.ts

**Files:**
- Create: `packages/identity/enterprise-identity/src/employee-store.ts`
- Test: `packages/identity/enterprise-identity/tests/employee-store.spec.ts`

- [ ] **Step 1: 写失败测试**——每个 API 一个行为用例：`createEmployee` 拒绝重复 id、`listEmployees(orgId)` 只返回本组织且不含 archived（除非 `includeArchived`）、`updateEmployeeState` 对 archived 终态再变更抛错、`enqueueInbox` 返回 queued 行、`claimInbox(employeeId, limit)` 只取 queued 且按 `created_at` 排序并置 delivered+`delivered_at`、`bindSticky` 幂等覆盖、`resolveSticky` 未绑定时返回 undefined。测试内用 `:memory:` 库 + `migrateEnterpriseIdentity` 造环境（模式照抄 `tests/` 里既有 spec 的 setup）。
- [ ] **Step 2: 运行确认失败**（模块不存在）。
- [ ] **Step 3: 实现**——只此文件允许出现 SQL；导出纯函数族，行→对象解析在此处做运行时校验（durable/file 边界）；全部导出带 JSDoc。函数签名：

```ts
export function createEmployee(database: DatabaseSync, row: EmployeeAccountRow): void
export function getEmployee(database: DatabaseSync, id: string): EmployeeAccountRow | undefined
export function listEmployees(database: DatabaseSync, orgId: string, options?: { includeArchived?: boolean }): EmployeeAccountRow[]
export function updateEmployeeState(database: DatabaseSync, id: string, state: 'active' | 'suspended' | 'archived', at: number): void
export function ensureSurface(database: DatabaseSync, row: SurfaceRow): SurfaceRow
export function attachSurfaceSession(database: DatabaseSync, id: string, sessionId: string): void
export function enqueueInbox(database: DatabaseSync, row: InboxRow): void
export function claimInbox(database: DatabaseSync, employeeId: string, limit: number, at: number): InboxRow[]
export function bindSticky(database: DatabaseSync, orgId: string, actorKey: string, employeeId: string, at: number): void
export function resolveSticky(database: DatabaseSync, orgId: string, actorKey: string): string | undefined
```

- [ ] **Step 4: 测试全绿 + `pnpm run typecheck`。**
- [ ] **Step 5: Commit**：`feat(enterprise): add employee identity row store`

---

### Task 3: 包 @deepseek-ai/dsh-employee-account（ctx.employeeAccounts）

**Files:** 见文件结构；`package.json` 照抄 `packages/enterprise/enterprise-postgres/package.json` 的 exports/files 形态（依赖改为 `@deepseek-ai/dsh-enterprise-identity` workspace:^，peer `@deepseek-ai/cordis`）。

- [ ] **Step 1: ids.ts**——三个 Branded id（照 `packages/core/session` 的 brand 用法）：

```ts
/** Durable identifier of one persistent digital employee. */
export type EmployeeId = Branded<'EmployeeId'>
/** Read a raw string as an EmployeeId without validation. */
export function employeeId(value: string): EmployeeId
```

- [ ] **Step 2: types.ts**——领域类型 + Service 接口（这是全链路契约，后续任务只消费不再改）：

```ts
/** Lifecycle of one persistent employee account; archived is terminal. */
export type EmployeeState = 'active' | 'suspended' | 'archived'
/** One persistent digital employee account. */
export interface EmployeeAccount {
  readonly id: EmployeeId
  readonly orgId: string
  readonly displayName: string
  readonly roleCard: string
  readonly activeReleaseId?: string
  readonly state: EmployeeState
  readonly homeWorkspacePath: string
}
/** One queued inbound item waiting for its employee. */
export interface EmployeeInboxItem {
  readonly id: InboxItemId
  readonly employeeId: EmployeeId
  readonly surfaceId: SurfaceId
  readonly originActor: string
  readonly payloadText: string
  readonly state: 'queued' | 'delivered' | 'failed'
}
/** Enterprise employee account service. */
export interface EmployeeAccounts {
  create(input: { orgId: string; displayName: string; roleCard: string; homeWorkspacePath: string; activeReleaseId?: string }): EmployeeAccount
  get(id: EmployeeId): EmployeeAccount | undefined
  list(orgId: string, options?: { includeArchived?: boolean }): EmployeeAccount[]
  setState(id: EmployeeId, state: EmployeeState): void
  bindSticky(orgId: string, actorKey: string, id: EmployeeId): void
  resolveSticky(orgId: string, actorKey: string): EmployeeId | undefined
  enqueue(input: { employeeId: EmployeeId; surfaceId: SurfaceId; originActor: string; payloadText: string }): EmployeeInboxItem
  claim(employeeId: EmployeeId, limit: number): EmployeeInboxItem[]
}
/** Service key declared via declaration merging: `ctx.employeeAccounts`. */
export const employeeAccounts: 'employeeAccounts' = 'employeeAccounts'
```

- [ ] **Step 3: service.ts**——实现 `EmployeeAccounts`：构造时注入已迁移的 SQLite 句柄（`inject: ['enterpriseIdentity']` 风格，跟随包内既有 inject 模式；若企业身份库服务的 ctx 键名不同，以 `packages/identity/enterprise-identity/src/index.ts` 的实际导出为准）；`create` 校验 displayName/roleCard 非空、路径绝对；`setState` 禁止 archived→他态；组织域参数一律透传给 store，不做默认值。
- [ ] **Step 4: index.ts**——插件 `definePlugin`（照包组内其他服务的插件形态）：`ctx.effect()` 注册 service；`start()` 幂等。**不创建 invariant.ts**（服务是单一权威观测，无独立可发散观测）——在 README Dev Note 写明这一决定及依据（packages/AGENTS.md 的 invariant 规则）。
- [ ] **Step 5: 测试**——`tests/service.spec.ts` 覆盖接口全部方法 + 三条失败路径（空 displayName、archived 复活、跨组织 resolve 返回 undefined）；包级 100% 覆盖。`pnpm vitest run packages/enterprise/employee-account` 绿。
- [ ] **Step 6: README.md / README.zh.md / README.i18n.yaml**——按包组 README 结构（Summary / Use this package / Understand the implementation(折叠) / Dev Note），双语文义一致。
- [ ] **Step 7: Commit**：`feat(enterprise): add persistent employee account service`

---

### Task 4: 包 @deepseek-ai/dsh-enterprise-surface（ctx.surfaces + 投递桥）

**Files:** 见文件结构；package.json 依赖 `@deepseek-ai/dsh-employee-account`、`@deepseek-ai/dsh-webhook`（复用其创建范式时按实际需要）、peer cordis。

- [ ] **Step 1: types.ts**——契约：

```ts
/** One durable conversation surface; P0 ships the dm kind only. */
export interface Surface {
  readonly id: SurfaceId
  readonly kind: 'dm'
  readonly orgId: string
  readonly userId: string
  readonly employeeId: EmployeeId
  readonly sessionId?: string
}
/** Enterprise conversation surface registry and inbound delivery. */
export interface EnterpriseSurfaces {
  ensureDm(input: { orgId: string; userId: string; employeeId: EmployeeId }): Surface
  /** Resolve the sticky employee for one channel actor, falling back to the surface default. */
  stickyEmployee(orgId: string, actorKey: string): EmployeeId | undefined
  /** Enqueue one authenticated inbound message and deliver it to the employee's anchored session. */
  deliverToEmployee(surface: Surface, originActor: string, payloadText: string): InboxItemId
}
export const surfaces: 'surfaces' = 'surfaces'
```

- [ ] **Step 2: dm.ts**——`ensureDm`：store `ensureSurface`（唯一索引 user×employee 幂等）；若无 `session_id`，按 `packages/webhook/webhook/src/session.ts` 的模板创建 anchored session（employee 的 `home_workspace_path` 为 workspacePath、`agentPreset` 取 employee 的 release profile——P0 允许从 account 的 `activeReleaseId` 缺省到部署默认 preset，但**必须显式 resolve，不得 `??` 藏在 run 里**），随后 `attachSurfaceSession`。`deliverToEmployee`：`enqueue` → `claim(1)` → 通过 `ctx.agents` 向 anchored session 投递 user 消息（投递方式照抄 `packages/experimental/agent-team/src/mailbox.ts` 的 Steer 语义：运行中 step 边界注入，空闲则开新回合），durable 落定后才算 delivered；投递失败置 failed 并抛出。meta 里写 `originActor`/`originSurface`（跟随 envelope meta 的 `ignorable` 语义）。
- [ ] **Step 3: 测试**——fake agent host（内存实现 `ctx.agents` 最小面）验证：重复 `ensureDm` 返回同一 surface、session 只建一次；`deliverToEmployee` 幂等入箱、claim 后状态 delivered；投递抛错时行变 failed。100% 覆盖。
- [ ] **Step 4: README 三件套 + Dev Note 说明 omit invariant 的原因。**
- [ ] **Step 5: Commit**：`feat(enterprise): deliver employee dm messages through anchored sessions`

---

### Task 5: enterprise-controller HTTP 端点

**Files:**
- Create: `packages/api/enterprise-controller/src/employee-http.ts`
- Modify: `packages/api/enterprise-controller/src/index.ts`（挂载）
- Test: `packages/api/enterprise-controller/tests/employee-http.spec.ts`

- [ ] **Step 1: 写失败测试**——harness 照抄 `tests/recorder-binding-http.spec.ts`（同认证方式、同 supertest 风格）。用例：未认证 401；`GET /enterprise/employees` 只见本组织；`POST /enterprise/employees` 创建后可 `GET /enterprise/employees/:id`；`POST /enterprise/employees/:id/messages` body `{text}` 走 `deliverToEmployee` 且对 suspended 员工 409；actor 的 sticky 在首次私聊后可 `GET /enterprise/employees/sticky` 解析。
- [ ] **Step 2: 确认失败 → 实现 `employee-http.ts`**：四个端点全部位于既有企业认证/授权中间件之后（不新增鉴权机制）；错误映射：员工不存在 404、非本组织 404（不泄露存在性）、suspended/archived 409、空 text 400。响应体只含治理字段（id/displayName/state/roleCard），绝不回传 inbox payload 原文。
- [ ] **Step 3: 测试绿 + 包 typecheck。**
- [ ] **Step 4: Commit**：`feat(enterprise): expose employee dm endpoints on the enterprise controller`

---

### Task 6: 工作台员工详情与私聊入口

**Files:**
- Create: `packages/client/ui-enterprise-workbench/src/client/employees.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/store.ts`、`src/client/locales.ts`
- Test: `packages/client/ui-enterprise-workbench/tests/employees.client.spec.ts`

- [ ] **Step 1: store 切片**——`employees: { list: EmployeeSummary[]; selected?: EmployeeSummary }`，`loadEmployees()` / `sendMessage(employeeId, text)` 两个 action 走 Task 5 端点（fetch 封装照本 store 既有模式）。
- [ ] **Step 2: employees.ts**——按原型图 1/4 的简化形态渲染：员工列表行（头像字 + 名字 + 状态点）→ 详情（名字、状态点、roleCard、Release 徽标、记忆计数占位 `—`）+ 底部一条输入框 + 发送按钮（整屏唯一主按钮）。状态点只用颜色加 `aria-label`（无障碍：不只靠颜色，PRODUCT.md 要求）。
- [ ] **Step 3: locales.ts**——所有文案进 en/zh 字典并用 `t`；跑 `pnpm run test:docs` 确认 `verify-client-ui-i18n` 不报硬编码。
- [ ] **Step 4: 客户端测试**——渲染断言 + sendMessage 调用断言（照 `tests/store.client.spec.ts` 模式）。
- [ ] **Step 5: Commit**：`feat(workbench): show persistent employees with a dm entry`

---

### Task 7: 全链路验证与收尾

- [ ] **Step 1: 验收用例（集成测试，放 `packages/enterprise/enterprise-surface/tests/dm.e2e.spec.ts`）**：创建员工 → controller 端点发消息 → fake agent host 收到 user 消息且 meta 带 `originActor`/`originSurface` → inbox 行 delivered → 从内存 session log 投影出该 `user/message`（可回放断言）。这就是 spec §12 P0 的验收路径（WeCom 真机连线属部署证据，不在 P0 代码验收内，README 里如实声明"configuration readiness"）。
- [ ] **Step 2: `pnpm run typecheck && pnpm run lint`** 绿；新包 vitest 全绿。
- [ ] **Step 3: `pnpm run test:docs`** 绿（README 双语 + i18n 门禁）。
- [ ] **Step 4: Agent Note**：`.agents/notes/implemented/feature/2026-09-23-persistent-employee-p0.md`（中英双语 + i18n.yaml），记录：存储选型（身份 SQLite 而非 PG）的理由、投递桥复用 webhook 范式、Steer 投递语义、P0 不含 channel/group surface 与记忆层。
- [ ] **Step 5: Commit**：`test(enterprise): verify employee dm replay end to end`

---

## Self-Review 记录

- 覆盖检查：spec §12 P0 行的三个交付物（账户+收件箱+sticky / 投递桥+Web 私聊 / 员工详情基础视图）分别对应 Task 1–3、Task 4–5、Task 6；验收路径对应 Task 7。spec 的 channel/group/project、记忆五隔间明确不在 P0（§12 P1/P2）。
- 类型一致性：`EmployeeAccounts`/`EnterpriseSurfaces` 接口在 Task 3/4 定义后，Task 5/6 只消费；id 品牌类型只在 `employee-account/src/ids.ts` 定义一次。
- 占位符：无 TBD；"照抄 X 文件模式"均给出确切路径。

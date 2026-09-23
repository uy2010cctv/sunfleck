# 员工记忆 P1 实施计划（五隔间 + 记忆工具 + 写回分流）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 数字员工获得跨会话记忆——五隔间存储（org/department/project/agent/pair 同表不同 scope）、模型可见记忆工具集、写回按隔间分流（默认私有、晋升走审查）、注入按授权过滤并标注来源；验收：同一员工跨会话表现出私有经验，晋升提案进审查队列，个人偏好晋升被隐私门拦截。

**Architecture:** 存储是 P0 已验明的双实现镜像——记忆插件经 `enterprisePostgres.identity`（`EnterpriseIdentityStore` 接口）消费，SQLite（`packages/identity/enterprise-identity`，schema v6→v7）与 PG（`packages/identity/enterprise-identity-postgres`，v5→v6）两套实现必须同步扩展。写回管道（turn-stopping→outbox→LLM 抽取→propose/auto-approve）已存在，只加分流。注入走 `system-prompt/assemble` 的 contexts，复用 `system/message` 落日志（无需新 SessionEventMap 成员）。员工身份解析：anchored session 的 cwd === 员工 `home_workspace_path`（P0 建面时写入），注入监听器据此定位 L4/L5 归属。设计依据 [spec §7/§10/§12-P1](../specs/2026-09-22-persistent-digital-employee-design.md)。

**Tech Stack:** 同 P0（strict TS + ESM、SQLite STRICT、Cordis、vitest 100% 覆盖、双语文档门禁）。P0 代码已合入 master（c7fe4ffbe5），本分支 `sunfleck/employee-memory-p1`。

**仓库铁律（同 P0 计划）**：插件不改 agent-loop；无新 SessionEventMap 成员；跨边界 id 用 P0 已有 Branded 类型；全导出 JSDoc；单尾换行；新模型可见工具触发 recorded-session 快照要求（Task 6 处理）；无关脏文件（tsconfig.client.json、.zcodeignore、ui-workspace-files/）绝不入库；本机 oxlint 目录遍历与 third-party-notices hook 挂起——oxlint 用文件列表，notices 作业 --no-verify 并留证（零新增外部依赖时输出不变）。

---

## 文件结构

```
packages/identity/enterprise-identity/
  src/schema.ts                       # 修改：v7（scope/kind CHECK 扩 + 5 新列 + 配对 CHECK）
  src/memory-policy.ts                # 修改：scope 感知策略 classifyPrivacyForScope
  src/repository.ts                   # 修改：Entry/输入类型 + writePrivateMemory + listMemories 过滤 + touchMemoryAccess
  tests/…                             # 对应追加
packages/identity/enterprise-identity-postgres/
  src/schema.ts + migration.ts        # 修改：v6 同列
  src/repository.ts                   # 修改：与 SQLite 实现逐方法对齐
packages/context/enterprise-memory-context/
  src/index.ts                        # 修改：注入授权过滤/来源标注/排序；新记忆工具 ×5
  src/writeback-worker.ts             # 修改：按隔间分流
  src/writeback-extraction.ts         # 修改：抽取输出加 target 分类
  tests/…                             # 对应追加
packages/api/enterprise-controller/
  src/employee-http.ts                # 修改：GET /:id/memories + POST /:id/memories/:mid/review|retire
  tests/employee-http.spec.ts         # 追加
packages/client/ui-enterprise-workbench/
  src/client/employees.tsx / store.ts / locales.ts   # 修改：记忆分区 + 提案队列
snapshots/session/…                  # Task 6：新工具场景（record 可能需要 DEEPSEEK_API_KEY，缺则留 owner-local 记录）
.agents/notes/implemented/feature/2026-09-24-employee-memory-p1.md (+zh+i18n.yaml)
```

依赖方向不变：context 包经 `EnterpriseIdentityStore` 接口消费 identity；controller/workbench 只消费服务接口。接口扩成员时两套实现必须同一任务内完成（typecheck 红不过夜）。

---

### Task 1: 五隔间存储（双 schema + 接口 + 双实现）

**Files:** 上列 identity 两包的 schema/repository/tests。

- [ ] **Step 1 失败测试（先 SQLite 后 PG 同断言）**：v7/v6 迁移后 `scope_type` 接受 'agent'/'pair'（'project' 暂只放行 CHECK、无写入方——P2 启用）、`kind` 接受 'preference'；`scope_type='agent'` 要求 `agent_employee_id` 非空、`='pair'` 要求 `pair_user_id` 非空（配对 CHECK 拒绝缺列）；`writePrivateMemory` 直写 approved（不经 reviewMemory），重复 digest 幂等返回既有行；`listMemories` 新过滤（`agentEmployeeId`、`pairUserId`、`scopes` 数组）；`touchMemoryAccess` 更新 `last_access_at`；既有 organization/department 行为零改动（v6 库升 v7 数据保留）。
- [ ] **Step 2 确认失败 → Step 3 实现**：
  - SQLite `schema.ts`：版本 6→7；scope CHECK 加三值；kind CHECK 加 'preference'；新列 `agent_employee_id TEXT`、`pair_user_id TEXT`、`importance REAL NOT NULL DEFAULT 0`、`last_access_at INTEGER`；配对 CHECK 沿 :137-138 既有模式扩成三段；版本门分支加 `|| === 6`（纯增量，注释说明，同 P0 模式）。
  - PG `schema.ts`/`migration.ts`：版本 5→6 同列（TEXT/DOUBLE PRECISION），迁移行参照该目录既有 migration 模式。
  - `repository.ts`（两套）+ `EnterpriseIdentityStore` 接口（定义处 grep `interface EnterpriseIdentityStore`）：`EnterpriseMemoryEntry` += `agentEmployeeId?`/`pairUserId?`/`importance`/`lastAccessAt?`；`writePrivateMemory(input: {orgId, scope:'agent'|'pair', kind, summary, createdBy, agentEmployeeId?, pairUserId?}): Promise<Entry>`——跑 Step-2 的 scope 感知门（Task 2 前先接 `inspectEnterpriseMemory` 的 injection/too-long 两条硬门，personal-preference 放行），digest 幂等；`listMemories` 参数 += `scopes?`/`agentEmployeeId?`/`pairUserId?`；`touchMemoryAccess(id, at)`。行解析处运行时校验扩新封闭值集（同 P0 employee-store 的 enumColumn 手法）。
- [ ] **Step 4**：两套仓库各自测试全绿（PG 集成测试沿用既有 skip 规则）；`pnpm run typecheck` 0。
- [ ] **Step 5 Commit**：`feat(enterprise): store five-compartment employee memories`

### Task 2: 隐私门 scope 策略 + 写回分流

**Files:** `memory-policy.ts`、`writeback-extraction.ts`、`writeback-worker.ts` 及测试。

- [ ] **Step 1 失败测试**：`classifyPrivacyForScope(findings, scope)` — `prompt-injection`/`summary-too-long` 在一切 scope 阻断写入；`personal-preference` 在 organization/department 阻断自动 approve（写入则降级），在 agent/pair 放行。抽取输出新增 `target: 'private'|'organization'|'department'|'pair'` 字段（EXTRACTION_SYSTEM_PROMPT 契约同步 + parseExtractionOutput 校验）。worker 分流：默认（无 target/低置信）→ `writePrivateMemory` L4（agent_employee_id=会话归属员工）；target=pair → L5（pair_user_id=会话 owner）；organization/department 维持 propose/auto-approve 规则，但候选含 personal-preference finding 时**降级写 L4** 而非拒收（spec"个人偏好永不晋升"的机械实现）。
- [ ] **Step 2 实现 → Step 3 测试绿 + typecheck。**
- [ ] **Step 4 Commit**：`feat(enterprise): route memory writeback by compartment with scope-aware privacy`

### Task 3: 读取管线（授权过滤 + 来源标注 + 排序）

**Files:** `enterprise-memory-context/src/index.ts` 及测试。

- [ ] **Step 1 失败测试**（照 context.spec.ts 的真实 assemble 断言模式）：给定同 org 的 approved 记忆分属 org/department/L4/L5——① 注入文本按隔间分段并带来源标注（`[组织记忆]`/`[部门记忆]`/`[我的笔记]`/`[协作偏好]`，en/zh 标签定英文键、文案进代码常量并双语注释——注入文本是模型可见英文域，标签用英文 `[Organization memory]` 等，与既有 `<enterprise-memory>` 英文域一致）；② 员工 anchored session（cwd=home_workspace_path）只注入该员工 L4 + 对话用户 L5 + org/department；无员工归属的普通会话不注入任何 L4/L5；③ 排序 = 相关性（大小写不敏感关键词命中数）+ importance + recency 加权，预算 maxEntries/maxChars 维持；④ `touchMemoryAccess` 在注入时触达。员工解析：`listEmployees` 无按 cwd 查询——在 employee-account 服务加 `findByHomeWorkspacePath(path)`（Task 3 附带，SQLite 直查 + 测试）。
- [ ] **Step 2 实现 → Step 3 绿 + typecheck。Commit**：`feat(enterprise): recall employee memories with scoped authorized injection`

### Task 4: 模型可见记忆工具集

**Files:** `enterprise-memory-context/src/index.ts`（新工具注册，模板 = 同文件 remember_business_knowledge）及测试；快照场景在 Task 6。

- [ ] **五个工具**：`memory_search(query, scopeFilter?)`（自身可见隔间检索，走 Task 3 排序）；`memory_read(ids)`；`memory_write(scope:'agent', kind, summary)`（只允许 L4；过 scope 感知门；digest 幂等）；`memory_retire(ids)`（仅自己 L4/L5）；`promote_proposal(targetScope:'organization'|'department', summary, rationale)`（走 proposeMemory 审查流；personal-preference finding 原样拒回并向模型说明"个人偏好不入组织记忆"）。
- [ ] **actor 解析**：沿用 autoMemoryActor 既有链（request principal→session owner），L4 归属员工 = cwd 解析（Task 3 的函数复用）；无员工归属会话调用 memory_write → 明确报错。
- [ ] **测试**：每工具成功/失败路径（照 auto-memory.spec.ts 端到端模式）；模型可见 ⟺ 已记录由既有 tool/call 事件天然满足（测试断言 session log 含 tool/call）。
- [ ] **Commit**：`feat(enterprise): add the employee memory toolset`

### Task 5: 治理端点 + 工作台"它知道什么"

**Files:** `enterprise-controller/src/employee-http.ts` + 测试；`ui-enterprise-workbench` employees.tsx/store.ts/locales.ts + 测试。

- [ ] **端点**：`GET /enterprise/employees/:id/memories?compartment=`（治理字段 + compartment/status/sourceDigest 短摘要；404 同既有折叠；授权沿 employee.read）；`POST /enterprise/employees/:id/memories/:memoryId/review`（body `{decision:'approved'|'rejected', reason}`，走 reviewMemory CAS，映射 409 revision 冲突）；`POST .../memories/:memoryId/retire`。响应永不含 privacy_findings 明细与 source 原文。
- [ ] **UI**：员工详情加记忆区（按原型 1：五隔间色点行 + 条目列表 + proposed 队列的批准/否决双按钮）；store 切片 `staffMemories`；文案进字典双语；i18n 门禁绿。
- [ ] **Commit**：`feat(workbench): show what each employee knows with proposal review`

### Task 6: 验收 + 快照 + Agent Note

- [ ] **e2e 测试**（enterprise-controller employee-http.spec 或 enterprise-memory-context 新 spec，复用 harness）：① 会话 A 写 L4（memory_write 或 writeback worker 直调）→ 新会话 B（同员工同 cwd）assemble 注入含该条且带 `[My notes]` 标签 → 触达 last_access_at；② promote_proposal('organization', …) → 治理列表出现 proposed → reviewMemory approved 全链路；③ 含个人偏好的 promote_proposal → 拒回且组织记忆无该条。
- [ ] **快照场景**：新模型可见工具触发 recorded-session 要求——查 `snapshots/session/` 既有场景结构，搭好场景 fixture；`pnpm run test:snapshot:record` 需要 DEEPSEEK_API_KEY：有则录制并审查 diff；无则**停下报告**，把录制留给 owner（不伪造 expected 输出）。
- [ ] **验证清单**（同 P0 Task 7 模式）：typecheck 0；六个相关包 scoped vitest 全绿；`test:docs` 失败逐条归类 ours/pre-existing（ours 必须为零）；oxlint 文件列表覆盖全部改动 .ts/.tsx 0 错误。
- [ ] **Agent Note 三件套** `.agents/notes/implemented/feature/2026-09-24-employee-memory-p1.*`：问题（员工无跨会话记忆、注入无授权过滤/来源/排序、写回只有 org/dept 双轨）；决策（五隔间同表 scope、写私直 approvals、个人偏好永不晋升的降级语义、工具集与 cwd 员工解析、双 schema 镜像）；deferred（L3 compartment、consolidation/衰减、pgvector 升级、Web 工具卡片）；consequences。
- [ ] **Commit**：`test(enterprise): verify employee memory recall and promotion end to end`

---

## Self-Review 记录

- Spec 覆盖：§12 P1 行四交付物 ↔ Task 1（存储）、Task 2+4（工具与分流）、Task 3（注入管线）、Task 5（治理视图）；验收路径 ↔ Task 6。L3/consolidation 明确不在 P1。
- 类型一致：`writePrivateMemory`/`listMemories` 新签名在 Task 1 定义后，Task 2-5 只消费；scope 字面量联合 `'organization'|'department'|'project'|'agent'|'pair'` 单点定义于 identity 类型。
- 占位符：无 TBD；快照录制的密钥依赖已显式化（有键录制、无键 owner-local）。

# 组织飞轮 P3 实施计划（consolidation / 摘要 / 衰减 / 结项蒸馏）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 记忆的组织飞轮转起来——每隔间定期整合（去重合并/冲突接替/衰减归档/隔间摘要/L4 反思晋升候选）、项目结项自动蒸馏教训进部门/组织审查流、公告走 LLM 抽取、L3 可经工具写入；验收：项目结项后教训可晋升部门记忆并可在新会话被召回。

**Architecture:** consolidation 是宿主级周期作业（插件内置 interval，Config 可关）+ 管理员手动触发端点；纯逻辑（去重/衰减/接替判定）与 LLM 加工（摘要/反思/蒸馏）分层，LLM 不可用时结构整合照常、LLM 部分优雅跳过；冲突解决用**接替链**（旧条目 retired + `invalidated_by` 指向新条目，历史可回放）而非原地改写；去重用规范化精确 + 词元 Jaccard 阈值（pgvector 升级继续延期）。LLM 调用沿用写回抽取的 `ctx.llm` 模式。设计依据 [spec §7.4/§10/§12-P3](../specs/2026-09-22-persistent-digital-employee-design.md)。

**已定偏差/延续决策：**
- **D1** 触发 = 插件 interval（Config `intervalMs`，0 禁用）+ `POST /enterprise/consolidation/run`（管理员）；schedules 包不承载（无 org 级 schedule API，P2 D2 同源）。
- **D2** 冲突 = 接替链：`invalidated_by` + 旧条目 `retired`；不物理改写已批准条目的 summary。
- **D3** 隔间摘要 = `kind 'summary'` 附加条目（不接替来源；来源自然衰减）。
- **D4** L4 反思 = LLM 从高价值私有笔记生成晋升候选（proposed，进审查流，不自动生效），每轮有数量上限。
- **D5** 公告 LLM 抽取复用写回抽取契约；LLM 不可用/失败 → 回落 P2 的截断摘要提案（优雅降级）。
- **D6** 项目归档 = 自动蒸馏一次（教训 → 部门/组织 proposed，人审后才生效——PRODUCT.md 原则 6）+ 隔间此后拒绝写入；另有手动 `POST /enterprise/projects/:id/distill`。
- **D7** L3 工具写入 = `memory_write` 在项目会话内接受 `scope:'project'`（requireMember + active 校验）；团队/群隔间继续延期（不在本期）。

**Tech Stack / 铁律：** 同 P0-P2。分支 `sunfleck/memory-consolidation-p3`。

---

## 文件结构

```
packages/identity/enterprise-identity/
  src/schema.ts                    # v9：memories + valid_from/invalidated_by + kind + 'summary'
  src/repository.ts                # batchUpdateImportance / supersedeMemory / listMemories(kind+stale 过滤)
  src/employee-store.ts            # （如 v8→v9 重建立承接）
  tests/…
packages/identity/enterprise-identity-postgres/   # v8 同列 + 迁移携带
packages/context/enterprise-memory-context/
  src/consolidation.ts             # 纯逻辑：分组/衰减/接替判定/候选构建
  src/consolidation-runtime.ts     # interval + ctx.llm 加工 + 审计；ctx.memoryConsolidation
  src/index.ts                     # 公告抽取改造（D5）；memory_write 接受 project（D7）
  tests/…
packages/api/enterprise-controller/  # POST /enterprise/consolidation/run + POST /enterprise/projects/:id/distill
packages/client/ui-enterprise-workbench/  # 员工详情记忆区追加"整理来源"标识（ consolidation 产生的条目/摘要可辨识）
.agents/notes/implemented/feature/2026-09-27-employee-memory-p3.*
```

---

### Task 1: 存储支撑（SQLite v9 + PG v8）

- [ ] **失败测试**：v8→v9 / v7→v8 迁移保留数据；`kind` CHECK + 'summary'；新列 `valid_from INTEGER?`、`invalidated_by TEXT?`（自引用不做 FK，服务层维护——列注释说明）；`batchUpdateImportance([{id, importance, lastAccessAt?}])` 批量生效且行数返回；`supersedeMemory(oldId, newId, at)` 仅 approved→retired + 写 invalidated_by（重复接替/自接替抛错）；`listMemories` 新过滤 `kinds?`、`staleBefore?`（lastAccessAt/updated_at 早于且 status='approved'）。双库平行。
- [ ] **实现**：版本门沿既有增量注释模式；PG 迁移携带新列（照 20→22 列先例）。
- [ ] **Commit**：`feat(enterprise): store consolidation lineage and importance batches`

### Task 2: 整合纯逻辑 + LLM 加工

- [ ] **纯逻辑**（consolidation.ts，全函数式 + 单测）：`groupDuplicates(entries)`（规范化精确合并 + 词元 Jaccard ≥ 阈值分组，Config 阈值）；`decayImportance(entry, now, halfLifeDays)`（`importance × 0.5^(ageDays/halfLife)`，age 取 lastAccessAt ?? updatedAt；下限 0）；`supersedePlan(group)`（组内最新为存活者，其余 → supersede 指向它）；`retirePlan(entry, threshold)`；`digestCandidate(entries)`；`reflectionCandidates(privateEntries, limit)`。
- [ ] **LLM 加工**（照 writeback-extraction 的 ctx.llm.stream + strict JSON 契约模式）：`summarizeCompartment(llm, entries)` → 一段摘要文本；`reflectOnPrivateNotes(llm, entries)` → ≤limit 条 `{summary, targetScope, rationale}` 候选（各自过隐私门分类，shared 目标含任何 finding → 降级为仅 private 内部合并建议或丢弃）。解析失败/超时 → 结构化跳过。
- [ ] **Commit**：`feat(enterprise): add memory consolidation planning and llm refinement`

### Task 3: 整合运行时 + 手动触发

- [ ] **consolidation-runtime.ts**：`ctx.memoryConsolidation.runCompartment(orgId, compartment: {kind:'shared'|'project', scopeId?}): Promise<ConsolidationReport>`——流程：取隔间 approved 条目 → 结构整合（合并/接替/衰减 batch/低于阈值 retire）→ digest（每隔间保留最新一条 summary，旧的接替）→ L4 反思候选 → 全程审计（复用 appendAudit 形状：action 'enterpriseMemory.consolidate'）。interval：Config `intervalMs`（默认 6h，0 禁用）+ `orgIds`（默认全部）；每隔间串行；并发重入守卫。LLM 依赖 lazy 解析，不可用 → 跳过 LLM 步骤并在报告记录。
- [ ] **端点**：`POST /enterprise/consolidation/run`（管理员动作——查可用 action，报告选择；body {orgId?, compartment?} 缺省全量）→ 200 报告摘要；运行中 → 409。
- [ ] **测试**：报告结构、串行/重入、LLM 失败降级、审计。
- [ ] **Commit**：`feat(enterprise): run memory consolidation per compartment`

### Task 4: 项目结项蒸馏 + 只读 + L3 工具写入 + 公告抽取

- [ ] **结项蒸馏**：`distillProject(projectId, actor)`（新包 enterprise-project 不动；蒸馏逻辑放 memory-context，经 `ctx.enterpriseProjects.get` 校验 active/archived）——取项目隔间 approved 条目 → LLM 蒸馏 ≤N 条教训（每条过隐私门，shared 目标）→ propose 到部门（项目有 departmentId？无——propose 到 organization；报告里确认目标域选择）→ 审计。archive 流程挂钩：controller archive 端点在 archive 成功后触发（异步不阻塞响应，失败可见于审计/报告）。手动 `POST /enterprise/projects/:id/distill`。
- [ ] **只读**：archive 后项目隔间拒绝新写入——memory_write 的 project 分支与 proposeMemory 的 project 路径校验项目状态（经 `ctx.enterpriseProjects.get`；archived → 结构化拒绝）。召回保持（成员仍可见）。
- [ ] **L3 工具写入**：memory_write 增 `scope:'project'`（会话 actor.projectId 存在 + requireMember + active）。
- [ ] **公告抽取（D5）**：ingest_only 路径在 propose 前调 LLM 抽取（≤3 候选，逐条隐私门）；LLM 不可用/失败 → 现行截断摘要提案（保持 P2 行为）。测试双路径。
- [ ] **Commit**：`feat(enterprise): distill archived projects and extract announcements`

### Task 5: 验收 + Agent Note + 收尾

- [ ] **e2e（验收主链）**：项目会话写 L3 教训 ×3（含一条与旧条目近似重复、一条含个人偏好）→ archive → distill → 审查队列出现 proposed 教训（隐私/重复处理可见）→ approve → 新会话（同 org，非项目）assemble 在 `[Organization memory]` 召回该教训；consolidation run 后：重复被接替、importance 衰减生效、digest 条目存在、低于阈值条目 retired。
- [ ] **快照/文档**：新模型可见行为（memory_write project scope、公告抽取提案文本变化）→ 无 key 则 owner-local 记录；README/契约同步。
- [ ] **验证清单**：typecheck 0；相关包 vitest 全绿；test:docs ours=0；oxlint 分支文件 0；duplication ≤ 基线。
- [ ] **Agent Note 三件套** `2026-09-27-employee-memory-p3.*`。
- [ ] **Commit**：`test(enterprise): verify memory consolidation and project distillation end to end`

---

## Self-Review 记录

- Spec 覆盖：§12 P3 四项（consolidation job/晋升流/隔间摘要/衰减归档）↔ Task 2+3；验收链 ↔ Task 4+5。D3（团队/群隔间）第三次延期——Agent Note 记录理由（spec P3 四项不含，且 group/team 隔间依赖跨 run 摘要语义，随下一次迭代）。pgvector 升级继续延期。
- 类型一致：`ConsolidationReport`/候选/批次类型在 Task 2 定义，Task 3-5 消费；新列在 Task 1 定义后仅消费。
- 占位符：无 TBD；D1-D7 为已定决策。

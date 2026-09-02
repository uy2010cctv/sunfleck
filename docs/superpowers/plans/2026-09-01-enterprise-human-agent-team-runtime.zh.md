# 企业 Human-Agent 团队运行时实施计划

[English](2026-09-01-enterprise-human-agent-team-runtime.md) | 中文

> **供 agent 工作者使用：** 必须使用 test-driven-development 子 skill，逐项实施本计划。各步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 将企业 TeamRun 控制连接到现有基于 Session 的 Agent Teams 运行时，提供不可变 Employee Release、一等 Human 名册行、幂等决策、重启恢复和仅限企业版的组合。

**架构：** 扩展实验性 Agent Teams 事件日志和 fold，不另建任务、mailbox 或运行时存储。私有实验性企业适配器解析由 PostgreSQL 支撑的 Workspace 和 Release 记录，创建或恢复根 Agent 及可继续运行的队友，并实现 `EnterpriseTeamRuntimeDriver`；企业 overlay 在企业控制器之前加载该适配器。PostgreSQL TeamRun 行仍是查询投影，根 Session 日志是权威真源。

**技术栈：** TypeScript、Cordis、DSH Session/Agent/Subagent 服务、PostgreSQL 企业 repository、Vitest、pnpm 11.7.0、Node 22.23.2。

---

### 任务 1：扩展 Agent Teams 持久领域

**文件：**
- 修改：`packages/experimental/agent-team/src/types.ts`
- 修改：`packages/experimental/agent-team/src/fold.ts`
- 修改：`packages/experimental/agent-team/src/index.ts`
- 修改：`packages/experimental/agent-team/src/roster.ts`
- 测试：`packages/experimental/agent-team/tests/fold.spec.ts`
- 测试：`packages/experimental/agent-team/tests/team.spec.ts`

- [ ] 为旧版 agent 成员事件、Human 与 agent 名册投影、运行状态 revision 与操作幂等性、决策 CAS/幂等性和冷 fold 输出编写失败的回放测试。
- [ ] 运行 `pnpm exec vitest run packages/experimental/agent-team/tests/fold.spec.ts packages/experimental/agent-team/tests/team.spec.ts`，确认失败指向缺失的 TeamRun/Human/Decision 行为。
- [ ] 添加带版本的 `team/run`、`team/human-member` 和 `team/decision` 事件；保留现有 `team/member` payload 作为向后兼容的 agent 记录，并允许携带可选企业 Release 元数据。
- [ ] 添加 Team 服务方法，在现有 Team journal 序列化器下变更根 Session 状态，并通过 `TeamView` 暴露运行/决策元数据；不得通过仅限 agent 的方法授权 Human 调用方。
- [ ] 重新运行聚焦测试并保持通过。

### 任务 2：将不可变员工组合传入可继续运行的队友

**文件：**
- 修改：`packages/experimental/agent-team/src/types.ts`
- 修改：`packages/experimental/agent-team/src/roster.ts`
- 测试：`packages/experimental/agent-team/tests/team.spec.ts`

- [ ] 编写失败测试，证明 `SpawnTeammateRequest` 会转发 `agentOptions`、`persona` 和 `toolFilter`，并持久化 `employeeReleaseId` 与 `roleId`，且不携带 Human principal 或凭证载体。
- [ ] 运行聚焦 Team 测试，确认捕获到的 continuable request 缺少这些字段。
- [ ] 转发 Subagent request 已支持的字段，并在持久成员快照中保留 Release 身份。
- [ ] 重新运行聚焦 Team 测试和 Team 基线测试套件。

### 任务 3：添加精确 Release 查询和脱离请求上下文的执行

**文件：**
- 修改：`packages/catalog/enterprise-catalog/src/repository.ts`
- 修改：`packages/identity/enterprise-auth-web/src/request-context.ts`
- 测试：`packages/catalog/enterprise-catalog/tests/repository.spec.ts`
- 测试：`packages/identity/enterprise-auth-web/tests/request-context.spec.ts`

- [ ] 为受组织边界约束的 `getRelease(releaseId, orgId)` 和 `withoutPrincipal()` AsyncLocalStorage 执行编写失败测试。
- [ ] 运行两个聚焦测试，确认这些方法尚不存在。
- [ ] 实现校验 digest 的 Release 查询和请求上下文退出，且不暴露替代 principal。
- [ ] 重新运行两个聚焦测试。

### 任务 4：实现企业运行时驱动

**文件：**
- 创建：`packages/experimental/enterprise-team-runtime/package.json`
- 创建：`packages/experimental/enterprise-team-runtime/tsconfig.json`
- 创建：`packages/experimental/enterprise-team-runtime/tsdown.config.ts`
- 创建：`packages/experimental/enterprise-team-runtime/src/index.ts`
- 创建：`packages/experimental/enterprise-team-runtime/src/invariant.ts`
- 测试：`packages/experimental/enterprise-team-runtime/tests/runtime.spec.ts`

- [ ] 为确定性根身份、授权 Workspace 解析、不可变 Release 固定、Human 名册、领队与队友创建、启动幂等性、不支持的绑定、未知/跨组织 Release、部分 spawn 清理、取消后的完全停稳、决策响应/唤醒、冷 reconcile、重启后回放和无 principal 继承编写失败的真实组合测试。
- [ ] 运行新包测试，确认失败由驱动缺失导致。
- [ ] 实现 `ctx.enterpriseTeamRuntimeDriver` 的 Cordis 提供方，解析 Release 快照和已配置的模型路由，挂载固定 preset 与不可变 persona，拒绝不支持的能力绑定，将根 Session 绑定到 actor 和真实 Workspace，并持有归属的根句柄直至 dispose。
- [ ] 实现重启安全的根恢复、权威运行/决策变更、队友 drain、确定性错误和仅 fold 的 reconcile。
- [ ] 重新运行该包测试直至通过。

### 任务 5：仅在企业 profile 中组合并强制要求驱动

**文件：**
- 修改：`apps/cli/config/enterprise.cordis.patch.yml`
- 修改：`apps/cli/package.json`
- 修改：`packages/api/enterprise-controller/src/index.ts`
- 测试：`packages/bundle/web-app/tests/enterprise-workbench-composition.spec.ts`
- 测试：`packages/api/enterprise-controller/tests/team-control-controller.spec.ts`

- [ ] 编写失败的组合测试，要求在控制器之前加载 Agent Teams core/tool/client 和运行时适配器，同时保持普通 Web 组合包不变。
- [ ] 编写失败的控制器测试，证明缺少运行时注入会在组合阶段失败，而非返回虚假的可用运行时。
- [ ] 按顺序插入仅企业版使用的条目和依赖；让 TeamRun 与 Decision 控制器强制依赖运行时服务。
- [ ] 重新运行组合与控制器测试。

### 任务 6：准确记录能力与限制

**文件：**
- 修改：`packages/experimental/agent-team/README.md`
- 修改：`packages/experimental/agent-team/README.zh.md`
- 修改：`docs/subsystems/agent-team.md`
- 修改：`docs/subsystems/agent-team.zh.md`
- 创建：`packages/experimental/enterprise-team-runtime/README.md`
- 创建：`packages/experimental/enterprise-team-runtime/README.zh.md`
- 创建：`packages/experimental/enterprise-team-runtime/README.i18n.yaml`
- 创建：`.agents/notes/implemented/feature/2026-09-01-enterprise-human-agent-team-runtime.md`
- 创建：`.agents/notes/implemented/feature/2026-09-01-enterprise-human-agent-team-runtime.zh.md`
- 创建：`.agents/notes/implemented/feature/2026-09-01-enterprise-human-agent-team-runtime.i18n.yaml`

- [ ] 记录根 Session 权威、不可变 Release 元数据、Human 仅控制访问、不支持的 Release 绑定、共享 checkout 和当前仅支持 Agent task owner 的限制。
- [ ] 明确实验性/Release 边界，不宣称已提升为稳定能力。
- [ ] 使用仓库生成器更新翻译配对记录。

### 任务 7：生成、验证、自审并提交

- [ ] 运行聚焦包测试以及现有 Agent Teams、企业 operations 和控制器基线测试。
- [ ] 对触及的包运行类型检查/构建、Cordis catalog 生成和文档配对门禁。
- [ ] 检查 `git diff`，运行 `git diff --check`，确认没有生成产物或无关残留，并逐条对照本计划审查要求。
- [ ] 创建包含完整实现的单个提交，并报告准确 SHA、RED/GREEN 命令及所有如实说明的限制。

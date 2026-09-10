# Agent 自动记忆实施计划

[English](2026-08-28-agent-auto-memory.md) | 中文

> **面向 Agent 工作器：** 必须使用 `subagent-driven-development`（推荐）或 `executing-plans`，按任务逐项实现。步骤使用复选框追踪。

**目标：** 让 DSH Agent 自主评估可持久化的业务知识，保存到当前企业或部门范围，并立即供后续 Agent 使用。

**架构：** 扩展已有的 `@deepseek-ai/dsh-enterprise-memory-context`：它负责解析当前 Workspace 授权并注入已批准记忆。注册一个模型可见工具，只能从调用 Agent 的 Workspace 推导范围；写入权威身份仓储、使用固定系统复核原因自动批准，并追加脱敏审计事件。用确定性内容摘要和记忆 ID 保证幂等；隐私检查与仓储校验始终必需。

**技术栈：** TypeScript、Cordis、DSH ToolRuntime/SystemPrompt、Schemastery、SQLite/PostgreSQL 企业身份适配器、Vitest。

---

### 任务 1：自动记忆契约测试

**文件：**

- 修改：`packages/context/enterprise-memory-context/tests/context.spec.ts`
- 测试：`packages/context/enterprise-memory-context/tests/context.spec.ts`

- [ ] 编写失败测试：注册 `remember_business_knowledge`，以拥有该范围的 Agent 执行，并断言产生已批准记忆与审计记录。
- [ ] 覆盖失败情形：缺失 Agent/cwd、部门不属于当前 Workspace、个人 Workspace 部门归属模糊、隐私发现与组织范围关闭。
- [ ] 覆盖幂等：相同范围、类别和规范化摘要返回同一记忆 ID，且只产生一条已批准记忆。
- [ ] 运行定向测试，确认工具与配置未实现时测试失败。

### 任务 2：模型工具与范围解析器

**文件：**

- 修改：`packages/context/enterprise-memory-context/src/index.ts`
- 修改：`packages/context/enterprise-memory-context/package.json`
- 修改：`packages/context/enterprise-memory-context/tsconfig.json`

- [ ] 扩展插件配置：`autoSave`、`actorUserId`、`allowOrganizationScope`。
- [ ] 注册带 `scope`、`kind`、`summary` 参数的 `remember_business_knowledge`。
- [ ] 从 `workspaceGrantByRootPath(agent.session.header.cwd)` 解析组织；部门只能来自部门授权，或个人 Workspace 所有者的主/唯一部门。
- [ ] 计算稳定的 memory source digest，并用 `agent-memory-<digest>` 作为 ID。
- [ ] 复用已批准记录，自动批准既有 proposed 记录，拒绝对应 rejected/retired 记录。
- [ ] 新记录先 `proposeMemory`，再用固定原因复核，并写入不含原始对话的审计记录。
- [ ] 加入 SystemPrompt 指引：仅评估可复用、非个人业务事实，并可自主调用工具。
- [ ] 运行定向测试并修复到通过。

### 任务 3：企业组合与治理投影

**文件：**

- 修改：`apps/cli/config/enterprise.cordis.patch.yml`
- 修改：`packages/client/ui-enterprise-governance/src/client/EnterpriseGovernanceSurface.tsx`
- 修改：`packages/client/ui-enterprise-governance/src/client/governance.module.css`
- 修改：`packages/client/ui-enterprise-governance/tests/surface.client.spec.tsx`

- [ ] 在企业 Profile 启用自动保存及组织范围。
- [ ] 治理 UI 标记自动批准记忆，并保留范围、类型和审计证据。
- [ ] 添加 UI 回归，说明 Agent 自动评估与即时生效，同时明确隐私检查不会绕过。
- [ ] 运行企业记忆与治理测试。

### 任务 4：发布验证

**文件：**

- 验证上述所有文件。

- [ ] 运行定向包测试、类型检查、Cordis catalog 验证和全仓构建。
- [ ] 在保留企业 PostgreSQL 环境的前提下重启 3081 的 `dsh web`。
- [ ] 验证工具出现在已组装的企业 Agent schema，且记忆页面标注自动批准项。
- [ ] 使用带范围的 conventional commit 提交实现。

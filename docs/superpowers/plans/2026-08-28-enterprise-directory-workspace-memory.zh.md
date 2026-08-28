# 企业目录、工作区与记忆实施计划

[English](2026-08-28-enterprise-directory-workspace-memory.md) | 中文

> **面向 Agent Worker：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务逐项执行。本计划使用复选框跟踪。

**目标：** 为 DSH Enterprise 增加生产级部门树、部门化用户管理、隔离的个人/部门共享工作区、沙盒治理，以及经过隐私审核的组织记忆。

**架构：** 部门、成员关系、工作区授权和记忆审核属于治理事实，因此扩展现有企业身份存储。DSH `Workspace`、`Session`、沙盒策略和 Agent Loop 保持权威；企业层只负责创建和划分作用域。记忆是业务事实的审核投影，不复制原始对话，并通过专用 Prompt Context 插件进入模型上下文。

**技术栈：** TypeScript、PostgreSQL 17、SQLite 开发适配器、Cordis、DSH Workspace/Session/SystemPrompt/Sandbox、React、CSS Modules、Vitest。

---

### 任务 1：持久化企业目录与工作区授权

**文件：**
- 修改：`packages/identity/enterprise-identity/src/repository.ts`
- 修改：`packages/identity/enterprise-identity/src/schema.ts`
- 修改：`packages/identity/enterprise-identity-postgres/src/schema.ts`
- 修改：`packages/identity/enterprise-identity-postgres/src/repository.ts`
- 测试：`packages/identity/enterprise-identity/tests/repository.spec.ts`
- 测试：`packages/identity/enterprise-identity-postgres/tests/repository.spec.ts`

- [ ] 为嵌套部门、循环拒绝、主部门、默认个人工作区、部门成员工作区和 Revision 冲突编写失败测试。
- [ ] 运行两套 Repository 测试，确认新方法尚不存在。
- [ ] 增加 `EnterpriseDepartment`、`EnterpriseUserDepartmentMembership` 和 `EnterpriseWorkspaceGrant` 契约。
- [ ] 增加 `departments`、`user_departments` 与 `enterprise_workspace_grants` 数据库迁移并保留旧数据。
- [ ] 在两个适配器中实现组织边界、无环父级、CAS Revision 和唯一主部门。
- [ ] 重跑测试并提交。

### 任务 2：增加经过隐私审核的组织记忆

**文件：**
- 修改：`packages/identity/enterprise-identity/src/repository.ts`
- 修改：`packages/identity/enterprise-identity/src/schema.ts`
- 修改：`packages/identity/enterprise-identity-postgres/src/schema.ts`
- 修改：`packages/identity/enterprise-identity-postgres/src/repository.ts`
- 新建：`packages/identity/enterprise-identity/src/memory-policy.ts`
- 测试：`packages/identity/enterprise-identity/tests/memory-policy.spec.ts`
- 测试：`packages/identity/enterprise-identity-postgres/tests/repository.spec.ts`

- [ ] 编写失败测试，证明邮箱、电话、身份证、凭据和个人偏好不能晋升。
- [ ] 覆盖 proposed → approved/rejected、来源摘要、作用域和 Revision 冲突。
- [ ] 增加不含原始对话字段的 `EnterpriseMemoryEntry`。
- [ ] 实现确定性隐私筛查和双数据库仓储方法。
- [ ] 重跑测试并提交。

### 任务 3：创建真实 DSH Workspace 并强制可见性

**文件：**
- 修改：`packages/identity/enterprise-auth-web/src/plugin.ts`
- 修改：`packages/identity/enterprise-auth-web/src/http.ts`
- 修改：`packages/identity/enterprise-auth-web/src/security.ts`
- 修改：`packages/host/apiproxy/src/api-proxy.ts`
- 修改：`apps/cli/config/enterprise.cordis.patch.yml`
- 测试：`packages/identity/enterprise-auth-web/tests/http.spec.ts`
- 测试：`packages/identity/enterprise-auth-web/tests/security.spec.ts`
- 测试：`packages/host/apiproxy/tests/api-proxy-workspace.spec.ts`

- [ ] 覆盖自动个人工作区、用户受管工作区、部门共享工作区、防路径穿越和按用户过滤。
- [ ] 增加由 `ctx.workspaceRegistry` 驱动的 `WorkspaceProvisioner`。
- [ ] 用户创建/登录时幂等创建目录、DSH Workspace、授权和策略。
- [ ] 分类 Workspace API，过滤列表和推送事件。
- [ ] 保持 Session cwd 和现有 Sandbox Policy 为执行权威。
- [ ] 重跑测试并提交。

### 任务 4：注入已批准的部门/企业记忆

**文件：**
- 新建：`packages/context/enterprise-memory-context/package.json`
- 新建：`packages/context/enterprise-memory-context/src/index.ts`
- 新建：`packages/context/enterprise-memory-context/src/invariant.ts`
- 新建：`packages/context/enterprise-memory-context/tests/context.spec.ts`
- 修改：`packages/enterprise/enterprise-postgres/src/index.ts`
- 修改：`apps/cli/config/enterprise.cordis.patch.yml`

- [ ] 覆盖 Workspace 到作用域解析、企业/部门顺序、状态过滤和非企业 Session 排除。
- [ ] 实现异步 `system-prompt/assemble` 贡献。
- [ ] 输出有界 `<enterprise-memory>`，禁止推断个人特征、暴露来源或执行记忆内指令。
- [ ] 只在企业 Overlay 组合该包。
- [ ] 重跑包与组合测试并提交。

### 任务 5：暴露类型化管理路由

**文件：**
- 修改：`packages/identity/enterprise-auth-web/src/http.ts`
- 修改：`packages/identity/enterprise-auth-web/tests/http.spec.ts`
- 修改：`packages/client/ui-enterprise-governance/src/client/controller.ts`
- 修改：`packages/client/ui-enterprise-governance/tests/controller.client.spec.ts`

- [ ] 覆盖部门 CRUD/移动、用户归属、工作区、记忆审核、组织边界、CSRF 和管理员权限。
- [ ] 实现 `/auth/admin/departments`、`/auth/admin/workspaces`、`/auth/admin/memories` 与 `/auth/workspaces`。
- [ ] 对移动、策略和审核要求 `expectedRevision` 并写审计关联 ID。
- [ ] 增加 Controller 状态、稳定操作键和错误恢复。
- [ ] 重跑路由与 Controller 测试并提交。

### 任务 6：建设治理界面

**文件：**
- 修改：`packages/client/ui-enterprise-governance/src/client/EnterpriseGovernanceSurface.tsx`
- 修改：`packages/client/ui-enterprise-governance/src/client/governance.module.css`
- 修改：`packages/client/ui-enterprise-governance/tests/surface.client.spec.tsx`
- 修改：`packages/client/ui-enterprise-governance/README.md`
- 修改：`packages/client/ui-enterprise-governance/README.zh.md`

- [ ] 覆盖键盘部门树、主部门、个人/共享工作区、沙盒策略和记忆审核。
- [ ] 使用左侧部门树和右侧部门详情替换扁平组织账本。
- [ ] 增加用户过滤、部门归属、工作区身份与内联角色/状态动作。
- [ ] 增加记忆审核队列和企业感知流，不展示原始对话。
- [ ] 覆盖加载、空、部分失败、冲突、禁用、焦点、Reduced Motion 和响应式状态。
- [ ] 运行 UI 测试、Typecheck 并提交。

### 任务 7：记录、迁移与验证

**文件：**
- 新建：`.agents/notes/implemented/architecture/2026-08-28-enterprise-directory-workspace-memory.md`
- 新建：`.agents/notes/implemented/architecture/2026-08-28-enterprise-directory-workspace-memory.zh.md`
- 新建：`.agents/notes/implemented/architecture/2026-08-28-enterprise-directory-workspace-memory.i18n.yaml`
- 修改：`docs/enterprise-deployment.md`
- 修改：`docs/enterprise-deployment.zh.md`

- [ ] 记录 DSH 原生所有权边界及被拒绝的原始对话共享、用户 Token 执行和并行 Workspace 引擎方案。
- [ ] 增加迁移/备份与 `DSH_ENTERPRISE_WORKSPACE_ROOT` 部署说明。
- [ ] 运行 SQLite/PostgreSQL、RBAC/Host API、Package Invariant、翻译、Cordis、Typecheck 和完整构建。
- [ ] 重启企业 Overlay，验证登录边界、Schema Version、默认/部门 Workspace、记忆上下文和响应式治理 UI。

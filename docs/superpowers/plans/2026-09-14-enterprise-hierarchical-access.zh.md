# 企业分级权限实施计划

[English](2026-09-14-enterprise-hierarchical-access.md) | 中文

> **Codex 执行要求：** 每项任务先写聚焦测试再实现，并在现有企业审计日志中保留每次授权决定的归因信息。

**目标：** 让渠道、企业记忆和数字员工遵循统一的组织、部门、员工和个人访问范围。

**架构：** 扩展现有 `enterprise-governance` 授权服务，不创建平行权限引擎。人类主体携带部门归属和负责部门；渠道后台运行携带员工服务身份。资源所有者发布稳定访问范围，`EnterpriseSecurity` 在现有授权与审计流程前解析该范围。控制器负责加载资源，治理包负责最终决定。

**技术栈：** TypeScript、Cordis 服务、Typert RPC、PostgreSQL/SQLite 企业仓库、Vitest、React 工作台。

---

## 子项目一：共享层级策略

### 任务一：定义主体、范围、动作和决定

**文件：**
- 修改：`packages/governance/enterprise-governance/src/index.ts`
- 测试：`packages/governance/enterprise-governance/tests/enterprise-governance.spec.ts`
- 修改：`packages/governance/enterprise-governance/README.md`
- 修改：`packages/governance/enterprise-governance/README.zh.md`

1. 为跨组织拒绝、部门成员、部门经理、精确员工服务身份和个人所有权添加失败测试。
2. 增加组织、部门、员工和个人资源范围。
3. 让主体携带人类部门上下文或员工服务身份。
4. 增加记忆读写、员工执行、渠道读写与执行动作。
5. 在层级范围内保留现有可见性规则。
6. 运行治理包聚焦测试。

### 任务二：补全人类主体和员工服务身份

**文件：**
- 修改：`packages/identity/enterprise-identity/src/repository.ts`
- 修改：`packages/identity/enterprise-identity-postgres/src/repository.ts`
- 修改：`packages/identity/enterprise-auth-web/src/security.ts`
- 修改：`packages/identity/enterprise-auth-web/src/request-context.ts`
- 测试：`packages/identity/enterprise-auth-web/tests/security.spec.ts`

1. 测试登录主体包含部门归属，且部门经理不能跨负责部门操作。
2. 把身份仓库的部门归属投影到认证主体。
3. 为后台运行提供非用户员工主体；该主体必须绑定一个不可变员工发布版本，且不能获得人类管理权限。
4. 让授权和审计保留有效主体，不借用浏览器用户身份。
5. 运行身份与认证测试。

## 子项目二：数字员工层级

### 任务三：持久化员工部门范围

**文件：**
- 修改：`packages/api/enterprise-controller/src/contract/employees.ts`
- 修改：`packages/catalog/` 与 `packages/enterprise/enterprise-postgres/` 下的目录类型、仓库和迁移
- 测试：`packages/api/enterprise-controller/tests/employee-controller.spec.ts`
- 测试：目录仓库测试

1. 覆盖负责人、同部门成员、部门经理和外部门成员的创建、读取与更新。
2. 在草稿和不可变发布版本中持久化稳定 `departmentId` 与访问范围。
3. 让列表、读取、保存、发布、回滚和执行使用共享层级策略。
4. 直接读取越权员工时按不存在处理，并从列表移除。
5. 运行目录和控制器测试。

### 任务四：在工作台显示范围与拒绝原因

**文件：**
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- 修改：`packages/client/ui-enterprise-workbench/src/client/store.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/locales.ts`
- 测试：`packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`
- 测试：相关渲染测试

1. 覆盖部门选择、范围标识和禁用管理动作。
2. 只使用组织目录提供部门选项。
3. 说明权限来自所有权、部门成员、部门管理或组织管理。
4. 运行客户端测试，并从真实 PR 服务录制产品界面 GIF。

## 子项目三：记忆层级

### 任务五：授权记忆读取和生命周期变更

**文件：**
- 修改：`packages/context/enterprise-memory-context/src/index.ts`
- 修改：`packages/context/enterprise-memory-context/src/writeback-runtime.ts`
- 修改：`packages/identity/enterprise-auth-web/src/http.ts` 中的记忆管理端点
- 测试：`packages/context/enterprise-memory-context/tests/context.spec.ts`
- 测试：`packages/context/enterprise-memory-context/tests/auto-memory.spec.ts`

1. 覆盖组织记忆、部门记忆、员工绑定知识和跨部门拒绝。
2. 让每次记忆查询使用同一层级范围。
3. 部门经理可审核本部门记忆，组织记忆审核保留给管理员。
4. 员工后台运行只读取明确授予该发布版本的组织、部门和员工范围。
5. 运行记忆与 HTTP 测试。

## 子项目四：渠道层级

### 任务六：把渠道绑定到员工服务身份与部门

**文件：**
- 修改：`packages/api/enterprise-controller/src/contract/channels.ts`
- 修改：`packages/operations/enterprise-operations/` 下的渠道配置持久化
- 修改：`packages/api/enterprise-controller/src/index.ts`
- 修改：`packages/enterprise/enterprise-cordis-runtime/src/index.ts`
- 测试：`packages/api/enterprise-controller/tests/channel-controller.spec.ts`
- 测试：`packages/enterprise/enterprise-cordis-runtime/tests/runtime.spec.ts`

1. 覆盖渠道负责人、部门经理、外部门成员和精确员工运行身份。
2. 在启用入站渠道上持久化部门 id 和必需的员工发布版本 id。
3. 让列表、读取、保存、归档和绑定使用共享层级策略。
4. 入站 Session 使用已绑定员工服务主体和精确受管工作区授权。
5. 拒绝发布目录工作区、歧义匹配和模糊匹配。
6. 运行渠道与运行时测试。

### 任务七：更新 IM 适配器协议

**文件：**
- 修改：相邻 `dsh-im` 仓库中的企业适配器与测试
- 修改：DSH 渠道部署配置和验证 fixture

1. 测试每个入站请求携带渠道 id、员工发布版本 id、组织 id 和部门 id。
2. 删除从工作目录或最近认证人类推导权限的回退路径。
3. 分别实测飞书允许回复与权限拒绝场景。

## 子项目五：迁移、文档和发布证据

### 任务八：在不扩大权限的前提下迁移现有资源

**文件：**
- 修改：相关单调数据库迁移
- 添加：部署迁移/就绪命令及测试

1. 只根据精确权威 id 回填员工与渠道范围。
2. 隔离只有显示名称、发布路径或歧义匹配的记录。
3. 为每个隔离资源给出修复动作，不选择第一个候选项。

### 任务九：记录并验证最终行为

**文件：**
- 添加：`.agents/notes/` 下的有效 Agent Note
- 修改：相关包 README 和 JSDoc
- 添加：本地知识库中的 `raw/2026-09-14-enterprise-hierarchical-access.md`

1. 用中英文记录范围矩阵、服务身份规则、迁移行为和审计原因。
2. 按 `dsh-pre-push-checks` 运行最小相关检查，包括聚焦测试、类型检查、文档门禁和产品快照。
3. 合并到 `master`、部署到 47，并通过持久化回读验证界面权限、允许流程和拒绝流程。

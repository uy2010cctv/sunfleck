# 企业渠道设置实施计划

[English](2026-09-02-enterprise-channel-settings.md) | 中文

> **供 agent 工作者使用：** 必须使用 subagent-driven-development 或 executing-plans，逐项实施本计划。各步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 为企业微信、飞书、钉钉和仅通知的个人微信增加经过认证、由 PostgreSQL 支撑的渠道设置控制面，且不在 Credential seam 之外存储密钥值。

**架构：** Enterprise Operations 负责可复用渠道配置及 revision/幂等规则。Enterprise Controller 通过中央 `channel.manage` 授权与审计公开按 principal 限定的 Remote 方法。工作台展示提供方能力、配置就绪度、Credential 引用、默认路由和生命周期动作；真实传输健康度仍必须来自适配器证据，绝不由已保存配置推断。

**技术栈：** TypeScript、Cordis、Typert Remote、PostgreSQL、React、CSS Modules、Vitest、pnpm。

---

### 任务 1：定义渠道管理约定

**文件：**
- 修改：`packages/operations/enterprise-operations/src/types.ts`
- 创建：`packages/api/enterprise-controller/src/contract/channels.ts`
- 修改：`packages/api/enterprise-controller/src/contract/index.ts`

- [ ] 添加失败的类型/API 测试，要求提供方、账号身份、Credential 引用、默认路由、入站策略、生命周期、revision 和时间戳。
- [ ] 运行 `pnpm exec vitest run packages/api/enterprise-controller/tests/channel-controller.spec.ts`，确认 namespace 尚不存在。
- [ ] 定义 `EnterpriseChannelConfiguration` 与 list/get/save/archive 请求。只接受 `credentialRef: string`，绝不接受密钥值。
- [ ] 将个人微信限制为通知、handoff 和状态，并强制关闭入站命令。

### 任务 2：使用 CAS 与幂等持久化渠道设置

**文件：**
- 修改：`packages/operations/enterprise-operations/src/schema.ts`
- 修改：`packages/operations/enterprise-operations/src/repository.ts`
- 修改：`packages/operations/enterprise-operations/src/service.ts`
- 修改：`packages/operations/enterprise-operations/tests/repository.spec.ts`

- [ ] 为创建、精确重试、过期 revision、跨组织查询、提供方能力校验、暂停和终态归档编写失败的 repository 测试。
- [ ] 运行 `pnpm exec vitest run packages/operations/enterprise-operations/tests/repository.spec.ts -t channel`，确认表和方法缺失。
- [ ] 增加 schema v13 表 `dsh_enterprise_channel_configurations` 及组织/提供方/状态索引。
- [ ] 使用现有签名 cursor、请求摘要和幂等存储实现组织范围 list/get/save/archive。
- [ ] 使用 `enterpriseChannel.*` 端点和现有授权/审计回调增加 Host 服务方法。

### 任务 3：公开经过认证的 Remote 管理

**文件：**
- 修改：`packages/identity/enterprise-auth-web/src/security.ts`
- 修改：`packages/api/enterprise-controller/src/index.ts`
- 创建：`packages/api/enterprise-controller/tests/channel-controller.spec.ts`

- [ ] 编写失败测试，证明管理员可以 list/save/archive，而 creator、operator、auditor 和 member 不能修改渠道。
- [ ] 将 `enterpriseChannel.*` 映射到 `channel.manage`；读取也仅限管理员，因为渠道账号标识和 Credential 引用属于治理数据。
- [ ] 实现 `enterpriseChannel.list/get/save/archive`，从认证 Host 上下文注入组织与 actor，并为每个请求写一条可归因审计。
- [ ] 重新运行 controller 与 security 测试。

### 任务 4：构建渠道设置工作台页面

**文件：**
- 修改：`packages/client/ui-enterprise-workbench/src/client/store.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/index.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.module.css`
- 修改：`packages/client/ui-enterprise-workbench/src/client/locales.ts`
- 修改：`packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`
- 修改：`packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`

- [ ] 为渠道导航入口、提供方能力边界、仅 Credential 引用的表单、就绪状态、保存、暂停、归档和个人微信入站锁编写失败 UI 测试。
- [ ] 将 `channels` 加入工作台状态及刷新/变更流程。
- [ ] 构建带连接路径的 Operate 界面：提供方/账号 → Credential 引用 → DSH 路由 → 允许意图。使用证据行，不使用等大仪表盘卡片。
- [ ] 明确 active/paused/draft/archived、未验证传输状态、校验、空、加载、错误、键盘、移动端和双语行为。
- [ ] 运行所有工作台测试及一次 Impeccable 检测器。

### 任务 5：记录并验证

**文件：**
- 修改：`PRODUCT.md`
- 修改：`DESIGN.md`
- 修改：`docs/user/guide/human-agent-teams.md`
- 修改：`docs/user/guide/human-agent-teams.zh.md`

- [ ] 更新当前能力措辞：配置管理已经实现；提供方投递、回执、lease 和实时 token 检查仍需要适配器/运行时证据。
- [ ] 运行渠道、operations、controller、workbench、PostgreSQL、typecheck、build、package-path、tsconfig-path 与翻译配对门禁。
- [ ] 检查最终 diff 中是否存在密钥字段、原始提供方 payload、跨组织访问和不受支持的个人微信写操作。

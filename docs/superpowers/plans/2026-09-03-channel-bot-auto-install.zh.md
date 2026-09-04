# 渠道 Bot 自动安装实施计划

[English](2026-09-03-channel-bot-auto-install.md) | 中文

> **面向 Agent 工作者：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项执行本计划。步骤使用复选框追踪。

**目标：** 完成 DSH 权威扫码流程，使可信提供方安装器返回已验证 Bot 元数据后，DSH 无需用户填写标识或 Credential 引用即可自动创建受治理渠道。

**架构：** `EnterpriseChannelController` 拥有签名、绑定 actor 且会过期的安装会话。仅 Host 可见的可选 `enterpriseChannelBotInstaller` 服务负责平台应用凭证和官方 API 交换；浏览器只接收官方授权 URL 与不透明 state。完成后，控制器派生不暴露身份的稳定渠道 ID、验证 Host Credential 引用，并通过现有组织范围 operations repository 提交渠道。

**技术栈：** TypeScript、Cordis 服务、Typert Remote、PostgreSQL 企业 operations、React、Vitest。

---

### 任务 1：提供方安装器契约与签名会话

**文件：**
- 修改：`packages/api/enterprise-controller/src/contract/channels.ts`
- 修改：`packages/api/enterprise-controller/src/index.ts`
- 测试：`packages/api/enterprise-controller/tests/channel-controller.spec.ts`

- [x] 添加失败测试，证明缺少安装器时返回 `setup-required`、配置安装器时返回 HTTPS 授权会话，并把 state 限定到组织与 actor。
- [x] 增加含 `begin` 和 `complete` 的 Host-only 安装器契约，并声明为可选 Cordis Context 服务。
- [x] 用 HMAC 签名安装 state、限制会话有效期并拒绝无效 URL 或不匹配 actor。
- [x] 运行控制器测试并要求全部通过。

### 任务 2：自动派生并持久化渠道

**文件：**
- 修改：`packages/api/enterprise-controller/src/contract/channels.ts`
- 修改：`packages/api/enterprise-controller/src/index.ts`
- 测试：`packages/api/enterprise-controller/tests/channel-controller.spec.ts`

- [x] 添加完成回调失败测试，模拟安装器返回已验证租户、应用、Bot 名称和 Host Credential 引用。
- [x] 按 `<provider>-<sha256(orgId, tenantId, accountId)[0..11]>` 派生 `channelId`，使用已验证 Bot 名称，并把路由保留在 DSH 决策路由器默认值。
- [x] 提交 active 渠道前验证 Credential 已配置，并使用回调幂等键与 `expectedRevision: 0`。
- [x] 保存后追加已验证 Bot 身份与租户证据。

### 任务 3：浏览器回调与纯扫码 UX

**文件：**
- 修改：`packages/client/ui-enterprise-workbench/src/client/channelBindingProfiles.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/index.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/store.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- 修改：`packages/client/ui-enterprise-workbench/src/client/locales.ts`
- 测试：`packages/client/ui-enterprise-workbench/tests/browser-plugin.client.spec.ts`
- 测试：`packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`

- [x] 添加安装回调、浏览器历史脱敏、完成广播、自动刷新和弹窗时序测试。
- [x] 扫码点击时同步预开授权窗口，只在 Remote 返回有效官方 HTTPS URL 后导航。
- [x] 从渠道 UI 移除账号、租户、应用、Credential、名称、ID 与 Release 字段。
- [x] 只呈现扫码进度、提供方确认、自动创建渠道事实和可恢复错误。

### 任务 4：文档、构建与本地部署

**文件：**
- 修改：`docs/user/guide/human-agent-teams.zh.md`
- 修改：`docs/user/guide/human-agent-teams.md`

- [x] 记录企业微信 Suite ticket/pre-auth code、飞书商店应用 app_ticket/tenant_key、钉钉第三方应用授权事件/SyncHTTP 前置。
- [x] 说明平台注册凭证只存在 Host 安装器，不进入浏览器状态或渠道记录。
- [x] 运行控制器与工作台测试、客户端类型检查和完整构建。
- [ ] 只提交任务文件，重启 `com.deepseek.dsh.local.3081` 并验收渠道页。

### 任务 5：飞书原生设备授权流

**文件：**
- 修改：`packages/api/enterprise-controller/src/contract/channels.ts`
- 修改：`packages/api/enterprise-controller/src/index.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- 修改：`packages/client/ui-enterprise-workbench/src/client/store.ts`
- 测试：`packages/api/enterprise-controller/tests/channel-controller.spec.ts`
- 测试：`packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`

- [x] 使用飞书官方 Node SDK `registerApp()` 获取设备授权扫码地址，无需预设 App ID、Secret 或公网回调。
- [x] 只向浏览器返回官方扫码 URL 和不透明安装 ID，由 Host 轮询完成状态。
- [x] 扫码确认后把 App Secret 直接保存到 Host Credential，自动创建受治理渠道，不向浏览器返回 Secret。
- [x] 在渠道页内嵌渲染真实二维码，自动等待结果并刷新已创建渠道。

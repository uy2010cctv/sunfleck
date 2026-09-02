# 官方渠道二维码绑定实施计划

[English](2026-09-02-channel-qr-binding.md) | 中文

> **供 agent 工作者使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 为企业微信、飞书、钉钉和个人微信增加各自官方二维码授权流程，同时保持 DSH 为权威，并且绝不把用户登录成功宣称为消息投递成功。

**架构：** Channel Kernel 负责纯提供方 profile、官方授权 URL 构造和 code 交换适配器。Enterprise Operations 只用 revision fence 在渠道记录上持久化已验证、非敏感的绑定证据。Enterprise Controller 签发短期、单 Host 绑定 state，通过 Credential seam 解析 App Secret、交换一次性 code 并写入证据。工作台打开由提供方托管的二维码页面，在弹窗回到同源 DSH 后完成回调、刷新证据路径，并把消息就绪度继续保持为独立状态。

**技术栈：** TypeScript、Cordis、Typert Remote、PostgreSQL、React、CSS Modules、Vitest、官方 OAuth 端点。

---

### 任务 1：提供方授权 profile

**文件：**
- 修改：`packages/channel/channel-kernel/src/index.ts`
- 修改：`packages/channel/channel-kernel/tests/channel-kernel.spec.ts`

- [x] 为提供方前置条件、官方文档 URL、授权端点、回调参数及个人微信仅身份边界编写失败测试。
- [x] 增加 `channelBindingProfile(provider)` 与 `channelAuthorizationUrl(input)`：企业微信 `CorpApp`、飞书 OAuth authorize、钉钉 OAuth2 authorize、个人微信网站应用 `snsapi_login`。
- [x] 增加 `exchangeChannelAuthorizationCode(input, fetch)`，只返回提供方身份、显示名和租户证据，绝不返回 access/refresh token。
- [x] 校验回调 URI、`state`、一次性 code、响应大小、超时和提供方错误。

### 任务 2：持久化已验证绑定证据

**文件：**
- 修改：`packages/operations/enterprise-operations/src/types.ts`
- 修改：`packages/operations/enterprise-operations/src/schema.ts`
- 修改：`packages/operations/enterprise-operations/src/repository.ts`
- 修改：`packages/operations/enterprise-operations/src/service.ts`
- 修改：`packages/operations/enterprise-operations/tests/repository.spec.ts`
- 修改：`packages/operations/enterprise-operations/tests/postgres.integration.spec.ts`

- [x] 为已验证证据、过期 revision、组织隔离、重新绑定和已归档拒绝编写失败 repository 测试。
- [x] 增加 schema v14 绑定字段：状态、提供方身份 id/名称、已验证租户、验证 actor 与时间；不保存授权 code 或提供方 token。
- [x] 增加 revision-fenced、幂等的 `verifyChannelBinding` repository/service 方法，并在 list/get 中投影证据。

### 任务 3：经过认证的 begin/complete Remote 流程

**文件：**
- 修改：`packages/api/enterprise-controller/src/contract/channels.ts`
- 修改：`packages/api/enterprise-controller/src/index.ts`
- 修改：`packages/api/enterprise-controller/tests/channel-controller.spec.ts`
- 修改：`packages/identity/enterprise-auth-web/src/security.ts`
- 修改：`packages/identity/enterprise-auth-web/tests/security.spec.ts`

- [x] 为 `beginBinding`/`completeBinding`、过期/篡改 state、回调不一致、Credential 缺失、角色拒绝、提供方错误和成功证据写入编写失败测试。
- [x] 签发 10 分钟 state envelope，包含组织、actor、渠道、提供方、准确 revision、准确回调 URI、nonce 与 expiry。单 Host 阶段 state 绑定进程；重启后要求管理员重新扫码。
- [x] 每次操作重新解析 App Secret，调用提供方交换适配器，随后清除局部引用，只保存非敏感证据。
- [x] 所有端点继续使用 `channel.manage` 和现有审计/correlation 路径。

### 任务 4：提供方定制绑定工作台

**文件：**
- 修改：`packages/client/ui-enterprise-workbench/src/client/store.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/index.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.module.css`
- 修改：`packages/client/ui-enterprise-workbench/src/client/locales.ts`
- 修改：`packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`
- 修改：`packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`

- [x] 为四种提供方说明、二维码资格、官方域名弹窗、待回调、已验证证据、重试、过期、键盘/移动端和无密钥输入编写失败 UI 测试。
- [x] 在每条渠道证据行内增加绑定轨道：前置条件 → 扫官方二维码 → 身份已验证 → 传输仍待验证。
- [x] 使用准确文案：企业微信需要 CorpID/AgentID/可信回调；飞书需要 App ID/重定向 URL；钉钉需要 Client ID/回调同源规则；个人微信需要已审核网站应用且仅身份/接管。
- [x] 在弹窗检测 `dsh_channel_binding=1&code&state`，调用 `completeBinding`，通过同源 `postMessage` 或按尝试隔离的 BroadcastChannel fallback 通知 opener，清除回调参数，并且只在成功后关闭。

### 任务 5：文档与发布门禁

**文件：**
- 修改：`PRODUCT.md`
- 修改：`DESIGN.md`
- 修改：`docs/user/guide/human-agent-teams.md`
- 修改：`docs/user/guide/human-agent-teams.zh.md`

- [x] 记录官方来源链接及身份与投递边界。
- [x] 完成本功能范围的发布门禁：定向矩阵的 18 个文件、257 项测试全部通过；`66953f09` 修正严格 fixture 类型后，typecheck 与生产构建通过；4,829 个文件的 package path 全部可解析；tsconfig 别名为最新；本次两组翻译配对一致。
- [ ] 运行可选的真实 PostgreSQL 验收。integration 文件已调用，但由于未设置 `DSH_TEST_POSTGRES_URL`，12 项测试全部跳过。
- [ ] 使全量 lint、全库翻译配对与 doc-sync 全部通过。它们仍有与本功能无关的全库 JSDoc/catalog、翻译配对、换行、子系统、Agent Note 和 package README 存量问题。
- [x] 保留任务 4 已执行的唯一一次 Impeccable detector；任务 5 不重复运行。
- [ ] 使用已认证管理员浏览器验收，但不输入或暴露 App Secret。在可用的平台应用与密钥提供前，真实提供方二维码流程仍未执行。

### 任务 4b：独立吸收 StaffDeck 已验证的渠道 UX 概念

**参考边界：** `/Users/kris/Documents/ChatGPT/数字员工/StaffDeck` 使用 AGPL-3.0。只能作为产品先例审查；不得把源码、样式、资产、协议代码或文案复制到 DSH。

**文件：**
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- 修改：`packages/client/ui-enterprise-workbench/src/client/channelBindingProfiles.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.module.css`
- 修改：`packages/client/ui-enterprise-workbench/src/client/locales.ts`
- 修改：`packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`

- [x] 为前置条件缺失、扫码过期/失败和已有记录的传输失败增加异常优先提醒条；`unverified` 传输属于中性证据，不作为事故提醒。
- [x] 始终分开显示四项真相：配置、二维码身份、默认 Employee/Team 路由和实际传输证据。
- [x] 增加不要求密钥值的提供方传输配置说明：企业微信智能机器人/应用可见范围、飞书最小机器人消息权限、钉钉 Stream 机器人/登录与分享回调、个人微信官方网站应用仅身份边界。
- [x] 使用明确区分待配置、可扫码、身份已验证、已暂停、已归档和传输待验证的状态/动作语言。
- [x] 保留 DSH revision/幂等/RBAC 与 Credential 引用 seam。本次二维码绑定不得实现 StaffDeck 的 AGPL 代码、iLink 传输、管理员模型、投递日志或会话存储。

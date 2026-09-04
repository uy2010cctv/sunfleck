# Human–Agent 团队协作模型（提案）

[English](human-agent-teams.md) | 中文

本页描述完整目标协作模型。源码 checkout 企业 profile 目前已能存储类型化 Team Definition、在 Agent Teams Session 日志上启动真实 TeamRun、投影 Human/Agent roster、把根 Session 作为 Team Room 打开、提供跨 Run 的 Human 决策队列，并提供受治理的渠道设置。Human task ownership、信任授权编辑器、版本感知能力资产装配和真实企业渠道投递仍属于拟议能力。

## 提案状态

当前实现保留 DSH 运行时归属，而不是增加另一个 Team 引擎。PostgreSQL 持久化可复用 Team Definition 与查询投影；experimental `TeamService` 和每个根 Session event log 拥有某次 TeamRun 的 actor roster、任务 DAG、mailbox、决策、验证和人工接管状态。

当前 experimental [Agent Teams 子系统](../../subsystems/agent-team.zh.md)会在源码 checkout 企业 profile 中提供持久 Human/Agent roster 投影、Agent-owned 任务 DAG、mailbox、TeamRun 状态和 Human 决策。PostgreSQL 提供 Team Definition、TeamRun/decision 查询投影、显式自治授权和管理员维护的渠道配置。Verifier 记录、Human task ownership 与提供方投递集成尚未完成。

## 拟议生命周期

### 1. 章程与定义

未来 Team Definition 将记录 Human 拥有的北极星、成功证据、非目标、约束、决策权、停止条件、审查节奏、一名 Agent Lead 以及 Human 和 Agent 角色模板。PostgreSQL 将是该可复用版本的持久化权威。

自治权将按 Agent、任务类型和能力设定范围，而不是使用一个全局标签。每个 Agent 将使用独立服务身份和 Credential 引用，而不是 Human 浏览器或渠道凭据。

### 2. 在源码 checkout 企业 profile 中启动

打开**团队**，选择已生效章程、Workspace，并输入本次工作目标。启动会在 Agent 工作开始前固定准确 Team Definition 修订、roster、Workspace、有效策略与不可变员工 Release 身份。后续定义编辑不会隐式修改活动 Run。

同一 `TeamService` 领域记录该 Run 的 Human 与 Agent 成员。Human 成员拥有企业用户身份但没有 Session；Agent 成员绑定 Session 和 Employee Release。打开 **Team Room** 会进入根 Session，并显示 Agent Teams roster 与任务投影。

### 3. 协调与验证

Agent Lead 将把北极星拆解为具有依赖关系的任务 DAG，在策略要求分离时分配 Doer 和独立 Verifier，协调现有 Team mailbox，并组装证据。Human 将保留目标、价值判断、自治权变更、策略例外和不可逆决策。

Doer 完成与 Verifier 决策将保持为不同运行时 event。证据将区分源码变更、定向测试、构建或打包、经认证行为、持久化业务状态、部署、提供方交付和最终业务结果，而不是把其中一项当作另一项的证明。

### 4. Human 决策与人工接管

runtime 决策请求携带问题、选项、建议、assignee、context digest、revision 与根 Session event 位置。打开**待我处理**可以回答分配给你的决策；每次回答都会根据所属根 Session 重新验证，之后才更新 PostgreSQL 投影。

人工接管将是同一 TeamRun 内记录在案的 Human 或 Agent actor 转换。微信 Bot 可以接收通知、查询状态并引导用户进入经认证的 DSH 接管；微信消息不能直接启动团队、回复决策、审批或修改 Team 状态。

### 5. 复盘与授权演进

复盘将对照章程与已记录证据，检查 Human 中断和未解决疑虑，并复核每项范围化授权。重复证据可以支持后续由 Human 审批的授权变更，但 Agent 或自动评分都不会扩大自治权。

可复用业务知识只会通过受治理的审查路径进入组织或部门记忆。原始对话、个人偏好、凭据和一次性推测将留在共享记忆之外。

## 拟议信任级别

该模型使用四个信任级别，每个级别均受 Agent、任务类型和能力限制：

- `observe` 读取已授权上下文和证据，但不修改工作或外部系统。
- `propose` 产生建议、草案、计划或决策请求，但不执行所建议的变更。
- `execute-reviewed` 在范围内执行，但在所需复核接受结果前不能推进依赖工作。
- `execute-delegated` 在范围内执行预先授权的可逆工作；不可逆操作和策略例外仍需 Human 审批。

## 渠道设置与交付边界

在企业工作台打开**渠道设置**，普通用户只选择提供方并扫码，不填写渠道名称、渠道 ID、租户、App ID、Credential 引用或数字员工 Release。Host 安装器完成官方授权交换后返回经过验证的租户、应用和 Bot 元数据；DSH 以组织、租户与应用身份的 SHA-256 摘要生成稳定渠道 ID，使用提供方 Bot 名称，绑定 Host 已保存的 Credential，并默认路由到 DSH 决策路由器。随后 DSH 以同一个幂等操作创建启用状态的渠道并记录已验证身份。

每次扫码安装使用有效期 10 分钟的 HMAC state，并绑定 Host 进程、组织、actor、提供方、固定回调 URI、nonce 与过期时间。授权 code 会在浏览器历史中先行清除，再交给 Host-only `enterpriseChannelBotInstaller`；浏览器永远收不到平台应用密钥、suite ticket、app_ticket、permanent code、access token 或 Credential 值。成功回调通过同源 BroadcastChannel 通知原窗口刷新自动创建的渠道；拒绝、过期、Host 重启或 actor/组织不匹配均失败关闭。

飞书已提供 DSH 内置的零配置通道：Host 调用飞书官方 Node SDK 的 `registerApp()` 设备授权流，将官方扫码地址交给页面，并在 Host 内轮询创建结果。管理员扫码并确认后，App ID 只用于派生可审计的 Credential 引用，App Secret 直接写入 Host Credential 存储，两者都无需人工填写，Secret 也不会出现在浏览器或 Remote 响应中。这一流程不需要预先创建飞书应用，也不依赖公网回调。

企业微信与微信也已提供内置扫码通道。企业微信流程参照腾讯企业微信团队的 `@wecom/wecom-openclaw-cli` 1.1.1：Host 请求官方二维码，保管 `scode`，轮询后直接将 Bot ID 和 Secret 写入受治理渠道与 Credential。微信流程参照腾讯的 `@tencent-weixin/openclaw-weixin` 2.4.8：Host 保管二维码会话值，扫码后保存 `ilink_bot_id` 和 `bot_token`。少数账号如果被微信要求额外校验，页面只在该时刻显示手机上的数字验证输入，不显示任何应用配置字段。

各提供方的真实边界如下：

- [企业微信 OpenClaw 官方插件](https://github.com/WecomTeam/wecom-openclaw-plugin)已验证公开的 Bot 扫码获取流程，DSH 直接使用同一企业微信端点协议，不安装或修改 OpenClaw。如改用企业微信第三方企业应用，则仍需 suite ticket 与 pre-auth code 适配器。
- [飞书扫码一键创建应用](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs)已由 DSH 内置实现；官方设备授权流在扫码确认后返回应用凭证，由 Host 直接保存。如改用飞书商店应用模式，则仍需独立适配 app_ticket 和 tenant_key 事件。
- [钉钉第三方企业应用](https://open.dingtalk.com/document/isvapp/application-authorization.md)通过应用广场授权开通；Host 适配器必须接收 SyncHTTP/RDS 授权事件，并从 org_suite_auth 或临时授权码取得企业与应用身份。
- [微信 OpenClaw 渠道](https://docs.openclaw.ai/channels/wechat)由腾讯微信团队维护，DSH 参照其公开的 iLink Bot 扫码协议实现账号绑定。微信渠道只允许非业务变更意图；Team 启动、决策回复与审批继续要求在经认证的 DSH 中完成。

飞书、企业微信 Bot 和微信 Bot 的内置扫码流程都不依赖 DSH 公网回调，因此可从本地 Host 完成绑定。飞书商店应用、企业微信第三方应用和钉钉等回调型安装仍需固定、公开可访问的 HTTPS 地址。扫码完成只证明应用/Bot 凭证已创建和保存，不等于消息投递成功；提供方适配器记录真实回执或健康证据前，传输状态保持**待验证**。

渠道体验在只把本地 AGPL-3.0 StaffDeck checkout 作为产品先例评审后独立设计。DSH 采纳了异常优先的配置提醒、分离的生命周期/配置/身份/路由/传输证据、提供方定制说明、扫码过期/重试以及中性的「待验证」状态等产品思路；没有复制 StaffDeck 的源码、样式、资产、协议实现或文案。本次企业微信/微信协议证据来自腾讯团队公开的 npm 包与仓库，不来自 StaffDeck。

工作台不会伪造真实会话/投递日志、管理员角色、独立身份绑定码或传输健康。这些能力必须来自 DSH 适配器与持久 inbox/outbox 证据、受治理的身份/角色、提供方回执、心跳或对账记录。

当前 Channel Kernel 路由决策仍为 `stickyEmployeeId` → 推断意图 → binding 默认值。Kernel 和适配器不持久化权威 selection；未来企业组合必须从 DSH 拥有的 binding 或 Session 投影推导 `stickyEmployeeId`。该集成属于迁移目标，不是当前能力。

后续真实提供方投递仍需要 durable inbox/outbox、稳定 `operationId`、lease、重试、回执、心跳证据与对账。只有提供方支持幂等键时，才能保证外部去重；不支持的提供方或返回模糊结果的超时必须产生可见的未知结果和对账任务，而不是 exactly-once 保证。

## 继续阅读

- [使用当前已交付的 Web UI](./index.zh.md)
- [查看当前 experimental Agent Teams 运行时](../../subsystems/agent-team.zh.md)
- [阅读拟议架构决策](../../../.agents/notes/proposed/architecture/2026-08-31-human-agent-team-control-plane.zh.md)

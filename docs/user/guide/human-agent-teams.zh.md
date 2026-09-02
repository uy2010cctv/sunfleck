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

人工接管将是同一 TeamRun 内记录在案的 Human 或 Agent actor 转换。个人微信可以绑定进入经认证 DSH 接管所使用的身份，但网站应用授权不提供官方个人聊天消息 API，也不能结算决策或修改 Team 状态。

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

在企业工作台打开**渠道设置**，可以创建、编辑、启用、暂停或归档企业微信、飞书、钉钉和个人微信配置。每条记录包含提供方/账号身份、Host 管理的 Credential 引用、默认数字员工 Release 路由、入站策略、生命周期状态与 revision。已启用企业微信记录还必须提供 CorpID 租户；飞书和钉钉可不填租户直接启用，DSH 不会伪造租户。本页不会要求或显示密钥值。

对满足前置条件的已保存渠道，**扫描官方二维码**会打开由提供方托管的 OAuth/二维码页面，而不是在 DSH 中渲染或代理提供方二维码。DSH 签发有效期 10 分钟的 state，绑定单个 Host 进程、组织、actor、渠道、提供方、准确 revision、固定回调 URI、nonce 与过期时间。Host 通过 Credential 引用解析 App Secret，交换一次性 code，只保存已验证的提供方身份、显示名称、租户证据、验证 actor 和时间。access token、refresh token、授权 code、提供方原始载荷和 App Secret 均不会持久化或显示。用户拒绝、过期或 Host 重启后都需要重新扫码。

扫码前需在对应提供方完成应用配置：

- [企业微信 Web 登录](https://developer.work.weixin.qq.com/document/path/98152)及其[身份 API](https://developer.work.weixin.qq.com/document/path/96442)需要 CorpID、AgentID 和 OAuth 可信回调域名。
- [飞书扫码 SDK/OAuth](https://open.feishu.cn/document/common-capabilities/sso/web-application-sso/qr-sdk-documentation)及其[用户 token 交换](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token)需要 App ID、App Secret 和已登记的重定向 URL；DSH 通过官方 `https://accounts.feishu.cn/oauth/v3/token` 端点交换 code。
- [钉钉官方登录 OAuth](https://open.dingtalk.com/document/isvapp/tutorial-enabling-login-to-third-party-websites.md)及其[用户 token 交换](https://open.dingtalk.com/document/isvapp/obtain-user-token.md)需要 Client ID、Client Secret 和钉钉「登录与分享」回调。
- [个人微信网站应用扫码登录](https://developers.weixin.qq.com/doc/oplatform/developers/dev/auth/web.html)需要已审核的网站应用、AppID、AppSecret、`snsapi_login` 和已登记的授权作用域。

生产环境必须使用一个固定、公网可访问、已登记的 HTTPS 回调。localhost HTTP 仅用于开发，提供方控制台可能不接受。

扫码成功只证明身份绑定和经认证的接管。企业渠道后续可以启用入站命令，但每个意图仍需通过 DSH 授权。个人微信网站应用授权不提供官方个人聊天消息 API，也不会把个人微信变成投递渠道。配置已保存、已启用或身份已验证都不代表投递成功：提供方适配器记录回执或健康证据前，传输状态保持**待验证**。

渠道体验在只把本地 AGPL-3.0 StaffDeck checkout 作为产品先例评审后独立设计。DSH 采纳了异常优先的配置提醒、分离的生命周期/配置/身份/路由/传输证据、提供方定制说明、扫码过期/重试以及中性的「待验证」状态等产品思路；没有复制 StaffDeck 的源码、样式、资产、协议实现或文案。StaffDeck 的个人微信 iLink 属于非公开/实验性传输，不在本官方二维码绑定范围内。

工作台不会伪造真实会话/投递日志、管理员角色、独立身份绑定码或传输健康。这些能力必须来自 DSH 适配器与持久 inbox/outbox 证据、受治理的身份/角色、提供方回执、心跳或对账记录。

当前 Channel Kernel 路由决策仍为 `stickyEmployeeId` → 推断意图 → binding 默认值。Kernel 和适配器不持久化权威 selection；未来企业组合必须从 DSH 拥有的 binding 或 Session 投影推导 `stickyEmployeeId`。该集成属于迁移目标，不是当前能力。

后续真实提供方投递仍需要 durable inbox/outbox、稳定 `operationId`、lease、重试、回执、心跳证据与对账。只有提供方支持幂等键时，才能保证外部去重；不支持的提供方或返回模糊结果的超时必须产生可见的未知结果和对账任务，而不是 exactly-once 保证。

## 继续阅读

- [使用当前已交付的 Web UI](./index.zh.md)
- [查看当前 experimental Agent Teams 运行时](../../subsystems/agent-team.zh.md)
- [阅读拟议架构决策](../../../.agents/notes/proposed/architecture/2026-08-31-human-agent-team-control-plane.zh.md)

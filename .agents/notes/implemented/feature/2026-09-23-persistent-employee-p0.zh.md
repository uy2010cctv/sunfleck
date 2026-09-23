# Agent Note: 持久数字员工 P0

Status: implemented

[English](2026-09-23-persistent-employee-p0.md) | 中文

## Problem

数字员工只在一次调用或 TeamRun 期间存在：会话之外没有员工身份，没有能为休眠员工暂存消息的收件箱，渠道消息没有进入员工会话日志的投递桥，sticky 绑定也没有存储。

## Decision

P0 把持久员工面落在企业身份 SQLite 存储上（schema v6）：`employee_accounts`、`surfaces`、`employee_inbox`、`sticky_bindings` 四张表。`ctx.employeeAccounts` 服务包负责账户事实、收件箱排队和 sticky 绑定。`ctx.surfaces` dm 桥为每对（用户，员工）锚定一个 Workspace 会话——按 webhook 会话模板创建、用 `Steer` 投递并做持久落地检查，会话日志记录该消息之后它才算已投递。`/enterprise/employees` 端点位于既有企业 cookie 认证和共享授权策略之后，投递成功时绑定 sticky；工作台员工视图列出员工并提供 DM 入口。

关键子决策：

- **存储放在身份 SQLite 存储里，而不是 Postgres。** 账户、收件箱行和 sticky 绑定是身份域的治理数据，与组织引导共享同一个事务域，而且活体 `DatabaseSync` 无法写进 cordis.yml 插件配置。
- **溯源挂在可合并扩展的 `surface-message` `MessageSourceMap` source 上**（`surfaceId`、`inboxItemId`、`originActor`），这是 webhook 模板已在用的通道；`SessionHeader` meta 只支持 `agentPreset` 和 `cwd`，谁发送了一条消息要从日志中的消息 source 重放。
- **投递按员工串行，会话创建按配对串行**，进程内单写者 promise 尾巴。
- **共享逻辑移到权威归属地而不是字节复制**：`pendingInboxMessages` 折叠位于 `@deepseek-ai/dsh-agent-loop/inbox` 子路径，`installInitialModelSelection` 位于 `@deepseek-ai/dsh-agent-default-model`。
- **控制器端点在部署组合提供两个插件之前回答 503 `employee-plane-unavailable`。** 组合归属是部署决策：企业 overlay 的身份存储是 Postgres，哪个部署挂载 SQLite 员工面不是本仓库的默认值。

## Alternatives considered

**把员工行放进企业 Postgres 存储。** 这会把一个治理域拆到两个存储里，并让组织引导事务够不到账户写入；身份 SQLite schema 已经拥有按组织划分的行。

**把来源 actor 记在 `SessionHeader` meta 里。** 头部只支持 `agentPreset` 和 `cwd`，每个溯源字段都要改头部 schema，而可合并扩展的消息 source 联合只需加一个成员——而且头部描述会话，不是每条消息。

**把收件箱折叠和模型选择安装字节复制进 surface 桥。** 副本会漂移；两个助手都有现成的权威归属地可移过去。

## Deferred

渠道、群聊和项目 surface；记忆分区（L4/L5）；release 到 preset 的解析（锚定会话使用显式 `defaultAgentPreset` 配置）；WeCom 实时接线（仅配置就绪）。

## Consequences

外部 dm 到员工会话现在有一条日志可重放的完整路径：已投递的 `user/message` 及其 `surface-message` source 可以从会话日志重建，而且一旦载荷无法再到达模型，落地检查会拒绝把收件箱行记为已投递。休眠员工通过按员工的收件箱持久接收消息。P1 记忆工作以 `EmployeeAccount` 作为员工身份继续构建。

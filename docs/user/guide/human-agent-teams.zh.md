# Human–Agent 团队协作模型（提案）

[English](human-agent-teams.md) | 中文

本页描述完整目标协作模型。源码 checkout 企业 profile 目前已能存储类型化 Team Definition、在 Agent Teams Session 日志上启动真实 TeamRun、投影 Human/Agent roster、把根 Session 作为 Team Room 打开，并提供跨 Run 的 Human 决策队列。Human task ownership、信任授权编辑器、版本感知能力资产装配和企业渠道命令仍属于拟议能力。

## 提案状态

当前实现保留 DSH 运行时归属，而不是增加另一个 Team 引擎。PostgreSQL 持久化可复用 Team Definition 与查询投影；experimental `TeamService` 和每个根 Session event log 拥有某次 TeamRun 的 actor roster、任务 DAG、mailbox、决策、验证和人工接管状态。

当前 experimental [Agent Teams 子系统](../../subsystems/agent-team.zh.md)会在源码 checkout 企业 profile 中提供持久 Human/Agent roster 投影、Agent-owned 任务 DAG、mailbox、TeamRun 状态和 Human 决策。PostgreSQL 提供 Team Definition、TeamRun/decision 查询投影与显式自治授权。Verifier 记录、Human task ownership 与渠道集成尚未完成。

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

人工接管将是同一 TeamRun 内记录在案的 Human 或 Agent actor 转换。个人微信可以通知 Human 并链接到经认证的 DSH，但不能结算决策或修改 Team 状态。

### 5. 复盘与授权演进

复盘将对照章程与已记录证据，检查 Human 中断和未解决疑虑，并复核每项范围化授权。重复证据可以支持后续由 Human 审批的授权变更，但 Agent 或自动评分都不会扩大自治权。

可复用业务知识只会通过受治理的审查路径进入组织或部门记忆。原始对话、个人偏好、凭据和一次性推测将留在共享记忆之外。

## 拟议信任级别

该模型使用四个信任级别，每个级别均受 Agent、任务类型和能力限制：

- `observe` 读取已授权上下文和证据，但不修改工作或外部系统。
- `propose` 产生建议、草案、计划或决策请求，但不执行所建议的变更。
- `execute-reviewed` 在范围内执行，但在所需复核接受结果前不能推进依赖工作。
- `execute-delegated` 在范围内执行预先授权的可逆工作；不可逆操作和策略例外仍需 Human 审批。

## 渠道与交付提案

首个交付阶段将只包含经认证的 DSH 核心协作闭环。后续阶段将从企业微信开始集成企业渠道，再为飞书和钉钉复用同一 DSH 适配器协议。个人微信将仍仅用于通知和 Human 接管传输。

当前 Channel Kernel 路由决策仍为 `stickyEmployeeId` → 推断意图 → binding 默认值。Kernel 和适配器不持久化权威 selection；未来企业组合必须从 DSH 拥有的 binding 或 Session 投影推导 `stickyEmployeeId`。该集成属于迁移目标，不是当前能力。

未来每项渠道或 outbox 操作都将持久化一个稳定 `operationId`。DSH 不会为同一 id 派发第二个逻辑操作。只有提供方支持幂等键时，才能保证外部去重；不支持的提供方或返回模糊结果的超时会产生可见的未知结果和对账任务，而不是 exactly-once 保证。

## 继续阅读

- [使用当前已交付的 Web UI](./index.zh.md)
- [查看当前 experimental Agent Teams 运行时](../../subsystems/agent-team.zh.md)
- [阅读拟议架构决策](../../../.agents/notes/proposed/architecture/2026-08-31-human-agent-team-control-plane.zh.md)

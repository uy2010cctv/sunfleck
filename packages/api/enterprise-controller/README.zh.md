---
description: "面向企业员工、资产、团队、审批、调度和工作记录的认证 Typert Remote API。"
kind: "package-reference"
---
# 企业 Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-enterprise-controller` 拥有企业员工、能力资产、固定团队、类型化团队定义、TeamRun、TeamDecision、自主权授权、工作记录、审批、调度、目标优先工作启动和用户配对设备的认证 Typert Remote namespace。每项操作都会解析 `EnterprisePrincipal`、执行组织与角色策略、记录审计决策，再委托给企业控制面。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

仅在企业 Profile 中，并在 `enterprisePostgres`、`enterpriseSecurity`、`enterpriseRequestContext` 和 `sessionController` 之后挂载本 Controller。Client 通过 API Gateway 使用生成的 `enterpriseEmployee`、`enterpriseAsset`、`enterpriseTeam`、`enterpriseTeamDefinition`、`enterpriseTeamRun`、`enterpriseTeamDecision`、`enterpriseTeamAutonomy`、`enterpriseOperation`、`enterpriseWork` 和 `enterpriseDevice` namespace。TeamRun start 和 cancel namespace 使用可选 `enterpriseTeamRuntimeDriver`；没有 provider 时，start 返回稳定 runtime-unavailable 失败。设备配对和 Computer Use 请求同时绑定已认证用户、Workspace、Session、短期操作 Permit 和设备签名。Host 注入组织与 actor 身份，browser 请求不能写 runtime revision 或 event position。本包不替代 DSH 的 Workspace、Session、Workflow、Sandbox、Subagent 或 Agent Loop 身份。

`enterpriseTeamDefinition` 将章程编辑与可执行历史分开：`draft` 追加不可变修订，`getDraft` 只向负责人可见地返回当前草稿而不替换 active 章程，`publish` 为后续 Run 提升一份已校验草稿，`discardDraft` 只归档该草稿。每个端点都使用既有 `team.read` 或 `team.manage` 策略与审计链路；调用者不能提供组织或 actor 身份。

员工发布会先写入不可变目录版本，再更新新 Session 使用的可写原生 Agent Preset。Preset 写入遇到瞬时失败会重试一次。持续失败时会明确说明目录版本已经发布并要求重试同步；未变化的已发布草稿会返回同一个版本。

三个 HTTP 边界与 Remote namespace 并列挂载：`/enterprise/employees` 下的员工 dm 与记忆治理路由（`employee-http`），`/enterprise/surfaces` 与 `/enterprise/projects` 下的协作面与项目路由（`surfaces-http`），以及令牌认证的入站路由 `POST /enterprise/channels/:channelId/inbound`——它把 `x-dsh-channel-token` header 与部署侧令牌比对，令牌未配置时一律返回 503。协作面与项目路由复用既有 cookie 认证、`channel.read` / `employee.create` / `employee.execute` 与 `team.read` / `team.manage` 动作，以及 `enterpriseSurface.*` / `enterpriseProject.*` 审计名；项目读对非成员折叠为 404，结构化未投递结果以 200 返回。项目路由承载项目蒸馏：`POST /enterprise/projects/:id/distill` 在成员门禁后运行蒸馏（记忆整理面未挂载时返回 503），`POST /enterprise/projects/:id/archive` 触发同一蒸馏但不等待其完成，项目结项从不因记忆工作而阻塞或失败。响应只承载治理字段——anchored session id、投递错误链、workspace 路径与成员允许列表都不会离开本包。

<a id="model-experience"></a>
## 模型体验

### 企业控制 API

#### What the model sees

无。这些 API 管理控制平面元数据，不会直接组装模型 Prompt 或执行 Agent turn。

#### Token effect

零 Token。`enterpriseTeamDefinition` Remote 调用不进入模型历史。

#### KV Cache 影响

在已发布员工启动普通 DSH Session 之前没有影响。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 首个企业 Profile 面向单组织和单套 PostgreSQL 部署。
- 企业实时失效事件不能替代重连后读取权威 Repository。
- 本包不提供具体 Agent Teams runtime driver、TeamRun UI 或渠道 adapter。
- 公开的 `EnterpriseWorkPrepareRequest`、`EnterpriseWorkStartRequest`、`EnterpriseWorkPreparation` 和 `EnterpriseWorkStartValue` contract 从包根和 `./types` 导出。
- `enterpriseWork.prepare` 按显式、调用者拥有的 Session、已授权最近提示、个人工作区的顺序解析已授权工作区。隐式个人工作区仅在恰有一个调用者拥有且仍然已授权、可见的工作区时自动采用；否则返回含已授权可见工作区 ID 的 `needs-workspace-selection`。单个已发布 preset 时自动选择其最新 release，多个 preset 时返回 `needs-selection`。`start` 从组织、用户和幂等键派生不透明 SHA-256 Session ID，随后在原生 Session 创建或绑定之前，原子性地把 canonical 请求指纹、不可变 release ID 与已解析的 Session 输入预留到 Enterprise Operations。以同一键传入变更后的输入会在副作用之前冲突；`starting` reservation 允许同一请求在 WorkRecord 写入失败后继续恢复，且 reservation 只会在 upsert 后标记为 `completed`。它只保存目标摘要和可选的允许截止日期，不做模型或能力路由、不创建团队、不接收附件、不分配预算，也不创建自主权授权。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

新增方法时须保持所有 Remote payload 可安全 JSON 序列化，并保留授权与审计调用。工作启动的幂等性必须让不透明的确定性 Session-ID 派生仅使用组织、用户和幂等键；在原生副作用前把 canonical 请求指纹、不可变 release ID 与已解析的 Session 输入预留到 Enterprise Operations，不得在 Session ID 中暴露请求值，reservation 指纹不同的复用键必须拒绝，并且仅在 WorkRecord 持久化后完成 reservation。

</details>

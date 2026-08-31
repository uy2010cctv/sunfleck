---
description: "面向企业员工、资产、团队、审批、调度和工作记录的认证 Typert Remote API。"
kind: "package-reference"
---
# 企业 Controller

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-api-enterprise-controller` 拥有企业员工、能力资产、固定团队、类型化团队定义、工作记录、审批和调度的认证 Typert Remote namespace。每项操作都会解析 `EnterprisePrincipal`、执行组织与角色策略、记录审计决策，再委托给 PostgreSQL 控制平面。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

仅在企业 Profile 中，并在 `enterprisePostgres`、`enterpriseSecurity` 和 `enterpriseRequestContext` 之后挂载本 Controller。Client 通过 API Gateway 使用生成的 `enterpriseEmployee`、`enterpriseAsset`、`enterpriseTeam`、`enterpriseTeamDefinition` 和 `enterpriseOperation` namespace。`enterpriseTeamDefinition` 提供 list、get、revision 防护的 save 和 archive；Host 注入认证组织，浏览器请求不携带组织或 actor 身份。Host service 在返回定义前执行 owner、管理员、private 和 restricted 可见性。本包替代已删除的单体 ApiProxy，但不替代 DSH 的 Workspace、Session、Workflow、Sandbox、Subagent 或 Agent Loop 身份。

<a id="model-experience"></a>
## 模型体验

### 企业控制 API

#### What the model sees

无。这些 API 管理控制平面元数据，不会直接组装模型 Prompt 或执行 Agent turn。

#### Token effect

零 Token。`enterpriseTeamDefinition` Remote 调用不进入模型历史。

#### KV Cache 影响

在已发布员工启动普通 DSH Session 之前没有影响。

## 已知限制与延期工作

- 首个企业 Profile 面向单组织和单套 PostgreSQL 部署。
- 企业实时失效事件不能替代重连后读取权威 Repository。
- 团队定义 Remote 方法不启动 TeamRun，也不协调 Agent runtime 工作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

新增方法时须保持所有 Remote payload 可安全 JSON 序列化，并保留授权与审计调用。

</details>

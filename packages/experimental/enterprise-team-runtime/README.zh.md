---
description: "通过实验性 Agent Teams Session 领域运行企业 Team Definition，并固定不可变员工 Release 与 Human 决策。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-enterprise-team-runtime

[English](README.md) | 中文

## 概述

这个仅限源码 checkout 的私有包基于现有 Agent Teams 根 Session 日志实现 `EnterpriseTeamRuntimeDriver`。它在选定企业 Workspace 中创建领队 Session，把每个 Agent 固定到不可变员工 Release，将 Human 登记为不具备 Agent 权限的 roster 成员，创建可继续 Agent teammate，并通过 `ctx.agentTeams` 追加 TeamRun 与 Human 决策事件。PostgreSQL 仍是查询投影；根 Session 事件日志拥有运行真相。

## 使用本包

企业 Web overlay 依次加载 Agent Teams、模型与浏览器消费者、本 adapter 和企业 controller。Workspace、Release、已配置模型路由、preset 或必需运行服务缺失时，adapter 会明确失败。普通 Web profile 不加载本包。

adapter 当前只接受不含能力资产绑定的 Release。已配置的 `modelRef` 与 Release persona 会装配到 Agent。绑定版本化 SOP、知识、技能、工具或模型资产的 Release 会被拒绝，直到 runtime assembler 能安装这些精确版本；adapter 不会宣称未挂载能力已经生效。

## 运行行为

- 根 Session id 从 TeamRun id 确定性派生，因此重复启动操作会对账同一日志。
- Human 成员会显示在共享 roster 中，但不会获得 Agent Session、mailbox 地址、工具权限或 Human 凭证继承。
- Agent 成员是可继续 child，其 descriptor 保留冷恢复所需的 Release id、角色、模型路由、persona 与工具过滤器。
- 启动、状态、取消、决策投影与 Human 回答使用稳定 operation id 和单调 runtime revision。
- 取消先记录权威事件，再中断 live root 与 child；持久状态继续可供回放。
- 对账折叠已存储根 Session，不要求 Agent 仍在线。

## 模型体验

Team Lead 与 Agent teammate 获得既有 Agent Teams policy 与工具。Release persona 和 TeamRun 目标对模型可见。Human roster 与决策记录只进入 Team 事件投影；Human 回答还会作为用户消息送达 Lead，使运行继续。

## 已知限制与延期工作

- 本包与 Agent Teams 包均为私有实验包，不进入正式发布。
- Team task 仍只支持 Agent owner；尚未实现 Human task ownership。
- 能力资产绑定会明确失败，不会部分挂载。
- runtime 为进程内所有权。持久日志支持重启对账，但多个进程不能并发拥有同一 Team。
- 外部渠道和企业 Team Room 属于独立产品层。

## 进一步探索

- [Agent Teams](../agent-team/README.zh.md)——roster、mailbox、任务 DAG 与持久 Team 事件。
- [人机团队协作模型](../../../docs/user/guide/human-agent-teams.zh.md)——拟议产品工作流与信任模型。
- [企业 Team runtime 决策](../../../.agents/notes/implemented/architecture/2026-09-02-enterprise-team-runtime-adapter.zh.md)——身份、权限、失败与恢复决策。

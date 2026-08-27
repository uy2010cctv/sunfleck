# Agent Note: 企业运营台使用经过身份校验的 read model

Status: implemented

[English](2026-08-27-enterprise-operations-deck-ui.md) | 中文

## Problem

第一版企业工作台投影 Agent Preset 和当前浏览器 Session 镜像。这对普通 Profile fallback 有价值，但无法操作企业 Host 中已有的持久员工 catalog、发布历史、审批、调度、能力资产或固定团队。如果把传输或权限失败当作 fallback 理由，还会扩大可见投影并隐藏真实失败。

## Decision

`@deepseek-ai/dsh-client-ui-enterprise-workbench` 是基于强类型 `enterpriseEmployees`、`enterpriseAssets`、`enterpriseTeams` 和 `enterpriseOperations` 客户端域的企业运营台。Overlay 内部导航管理数字员工、工作记录、审批、定时任务、能力资产和团队。企业治理、身份、凭据和模型管理继续属于 Settings。

员工名册把搜索、状态、可见性、负责人、limit 和 cursor 发送到 Host。员工编辑器加载一份持久草稿及其发布历史，在显式保存前只保留本地变更，校验受支持的 profile 字段，发送当前 `expectedRevision`，在 `enterprise-conflict` 时保留 dirty 输入，并把发布和回滚暴露为独立 mutation。工作、审批、调度、资产和团队页使用它们各自的强类型 read model 与 revision-fenced mutation。浏览器 payload 不包含 `orgId` 或 `principal`，这些值归经过身份校验的 Host 所有。

Runtime 的唯一 Host 流消费者在原生 Session 和 Workspace fold 之后发射已解码的 `connection/host-frame` 事件。每个企业 frame 都携带资源类型（`employee`、`asset`、`team`、`work-record`、`approval`、`schedule` 或 `outbox`）。工作台对 `eventId` 进行有界去重，按资源类型刷新对应 read model，不从当前可见页面猜测。所有 mutation 经过同一套可控错误、conflict 和重试状态，失败不会以未处理 rejection 逃逸。各页状态相互独立，因此 forbidden 或失败读取可以与已成功可用的页面共存。

普通 Profile 只在 `enterpriseEmployee.list` 明确报告企业 API 不可用时，才 fallback 到 Agent Preset、Session 和 Workspace 投影。授权、cursor、传输和其他内部失败保持可见，绝不触发 fallback。

## Alternatives considered

- **继续把 Agent Preset 和 Session 投影当作企业事实源** — 它不包含持久发布、审批、调度、资产或团队记录，无法表达按跨用户权限过滤的企业状态。
- **任何企业 API 错误都 fallback** — 会隐藏故障和授权失败，还可能展示比经过身份校验的企业 read model 允许范围更宽的原生投影。
- **把企业运营导航和治理放入同一管理员看板** — 普通运营人员需要业务记录，而身份、凭据、模型与组织策略已有由 Settings 所有的不同权限和任务边界。
- **由工作台再打开一条 Host 事件流** — 客户端 runtime 已拥有唯一 stream pump；转发已解码 frame 可保持单消费者传输所有权，同时让附加 read-model 客户端在本地订阅。

## Consequences

运营人员可以不离开 DSH overlay 就管理持久企业实体，同时原生会话仍是执行界面。运营台支持 320 px、平板和桌面布局；键盘焦点约束、Escape、dirty 离开确认、减少动效以及中英成对文案都是组件契约的一部分。能力绑定和策略正文仍是面向运营人员的 ID/JSON 输入，UI 刻意不展示生产力、SLA、百分比或推断的业务结果。聚焦 controller、React、API fallback、conflict、事件去重、mutation payload 和响应式样式的测试固定了这些边界。

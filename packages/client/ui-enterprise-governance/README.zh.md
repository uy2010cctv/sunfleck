---
description: "Enterprise login gate and identity, role, asset-policy, and audit administration UI。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-client-ui-enterprise-governance`

[English](README.md) | 中文

## 概述

Enterprise login gate and identity, role, asset-policy, and audit administration UI。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

企业登录和管理界面：

- 使用本地与已配置 SSO Provider 的全帧认证 Gate。
- 组织和树状部门编辑、用户部门归属与主部门、角色变更、启用/停用控制。
- 个人/部门 Workspace 清单及受治理的沙盒模式。
- 经过隐私筛查的记忆提案、审核队列和已批准的企业感知流。
- 为员工、模型、能力和渠道管理可见策略。
- 支持执行者和动作过滤的持久审计账本。
- 仅管理员可见的“设置”分区，不再重复占用 Sidebar 入口；Host RBAC 仍是权威来源。

## 记忆激活

已确认的手动条目使用「保存并激活」。常规 Agent 知识自动激活；待处理通道仅在异常或已有提案时出现。激活的记忆可以停用而不删除其审计历史。

自动捕获面板报告持久化的已完成轮次发件箱，不暴露复制的会话快照。已完成与跳过的工作保持紧凑；失败任务显示原因并提供重试入口。冲突候选继续走现有的异常审核通道。

## Model Experience

### 治理浏览器界面

#### What the model sees

无。该 UI 调用 `/auth` 管理端点，不贡献 Prompt、Message、Tool Schema、Result 或模型调用。

#### Token effect

零 Token。治理界面不进入 Session 历史。

#### KV Cache effect

无；打开或编辑治理状态不组装提供方请求。

## 已知限制与延期工作

- 首个 UI 使用中文运营文案；可通过 Locale Dictionary 扩展，无需修改 Host 策略。
- 只有已配置的 Provider 才显示外部 SSO 按钮。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

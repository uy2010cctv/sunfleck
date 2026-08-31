---
description: "面向 DSH Enterprise 的已审核企业、部门与用户私有记忆上下文。"
kind: "package-reference"
---
# @deepseek-ai/dsh-enterprise-memory-context

[English](README.md) | 中文

## 概述

面向 DSH Enterprise 的已审核企业、部门与用户私有记忆上下文。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

面向企业 Profile 的三层已审核记忆上下文。插件通过企业授权解析 Session cwd 和持久化 Session 所有者，只注入已批准的摘要。企业记忆在企业内共享，部门记忆跟随部门成员资格，用户记忆仅对所有者可见。它不加载原始对话、待审核／已驳回条目或当前范围外的记忆。

记忆值以带稳定 ID 的事实背景呈现，并附带明确的隐私与访问规范。启用 `autoSave` 时，`remember_business_knowledge` 将创建归因于 Session 所有者，将自动审核归因于配置的治理 Actor。仓储作用域、隐私、去重和生命周期校验仍是权威。

Prompt 组装先执行作用域 ACL 过滤，再通过确定性本地词法匹配选取有界的任务相关记忆包。当任务上下文为空时，回退到最新已批准条目。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

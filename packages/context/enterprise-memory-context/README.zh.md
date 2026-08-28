---
description: "Reviewed organization and department memory context for DSH Enterprise。"
kind: "package-reference"
---
# @deepseek-ai/dsh-enterprise-memory-context

[English](README.md) | 中文

## 概述

Reviewed organization and department memory context for DSH Enterprise。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

面向企业 Profile 的已审核组织/部门记忆上下文。插件通过企业工作区授权解析 Session cwd，只注入已批准的摘要；不会加载原始对话正文、待审核/已驳回条目或工作区隔离范围外的记忆。

记忆值以带稳定 ID 的事实背景呈现，并附带明确的隐私与访问规范。仓储审核和隐私筛查仍是权威；本包不负责抽取或批准记忆。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

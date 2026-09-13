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

启用自动业务记忆采集时，写入者依次取已认证请求主体和持久化的企业 Session 所有者。未绑定的后台运行必须配置已存在、且以 `service:` 开头的 `backgroundServiceUserId`；绝不会回退为 bootstrap 管理员。已确认的常规知识直接启用，不确定或冲突内容保持待确认。个人工作区偏好不会被提升为共享记忆。

记忆值以带稳定 ID 的事实背景呈现，并附带明确的隐私与访问规范。隐私筛查、范围检查和停用记录仍是权威。

## 轮后自动沉淀

启用 `autoSave` 与 `writebackEnabled` 后，每轮回答结束时先把有界的直接用户消息和最终回答写入 PostgreSQL 队列，再由独立模型在后台提取企业记忆。主 Agent 无需主动调用记忆工具，提取状态也不会伪装成用户消息。

提取器只比较同一企业及部门内已启用或待确认的记忆：精确重复跳过，高置信度且无冲突的知识直接启用，不确定、低置信度或冲突内容进入待确认。每次回写重新核验工作区与会话所有者。失败按 5、15、60、180 秒退避，最多自动尝试五次；成功后删除队列里的对话副本，只保留结果计数、记忆编号、时间和来源。管理台“自动沉淀”区域显示处理中、失败、最近结果和重试入口。

## Model Experience

### 已批准的企业记忆

#### What the model sees

只呈现符合当前 Workspace 授权的已批准组织或部门摘要。每项注入内容带稳定 `memoryId` 和范围；个人偏好与原始对话内容被排除。

#### Token effect

注入摘要在配置的条目与字符上限内消耗 Prompt Token。

#### KV Cache effect

已批准记忆保持有序且未变化时可能提高复用；实际缓存行为由 provider 决定。

## Known Limitations and Deferred Work

- 本包只沉淀简洁的企业业务记忆；Markdown 文档、笔记、任意文件和远程知识客户端属于独立的文档知识库能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

企业 Profile 默认启用轮后自动沉淀。任何提取都必须保留会话、轮次、工作区和操作者来源，冲突不得静默覆盖已启用内容。

</details>

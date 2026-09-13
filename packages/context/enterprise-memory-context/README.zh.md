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

启用自动业务记忆采集时，写入者依次取已认证请求主体和持久化的企业 Session 所有者。未绑定的后台运行必须配置已存在、且以 `service:` 开头的 `backgroundServiceUserId`；绝不会回退为 bootstrap 管理员。默认只创建待审核提案。只有匹配 `<orgId>:organization` 或 `<orgId>:department:<departmentId>` 的 `enterprise-memory-autonomy` 组织资源策略、策略为组织可见、包含该执行者且由启用状态的管理员创建时，才会自动启用。个人工作区偏好始终保持个人范围，本机制不会将其提升为共享记忆。

记忆值以带稳定 ID 的事实背景呈现，并附带明确的隐私与访问规范。仓储审核和隐私筛查仍是权威；本包不负责抽取或批准记忆。员工学习是独立的版本化资产工作流，它记录来源和审计结果，不会改变业务记忆审核策略。

## Model Experience

### 已批准的企业记忆

#### What the model sees

只呈现符合当前 Workspace 授权的已批准组织或部门摘要。每项注入内容带稳定 `memoryId` 和范围；个人偏好与原始对话内容被排除。

#### Token effect

注入摘要在配置的条目与字符上限内消耗 Prompt Token。

#### KV Cache effect

已批准记忆保持有序且未变化时可能提高复用；实际缓存行为由 provider 决定。

### 员工自主学习

#### What the model sees

企业配置默认挂载独立的 `./learning` 插件。员工完成可复用工作后调用 `learn_employee_capability`，传入类型、名称及工作区内的 Markdown 源文件路径，即可自动登记、绑定自身并发布能力版本，无需管理员确认。归属取当前会话员工身份；保留已有能力和未发布的人工草稿。当前及后续会话只加载本员工在该工作区学到的能力，不新增工具权限或数据访问权限。`maxLearningBytes` 限制每个源文件（默认 64000 个 UTF-8 字节）；`maxChars` 限制学习内容上下文，较长规程通过源文件按需读取。

#### Token effect

注入的学习指令最多消耗配置的 `maxChars`；较长规程只贡献简短源引用，供按需读取。

#### KV Cache effect

按版本固定的学习内容在员工发布下一个能力版本前保持稳定，可能保留提供方的前缀复用。

## Known Limitations and Deferred Work

- 本包不负责抽取、embedding 或批准源材料；仍需要仓储审核和组织策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

企业 Profile 有意不配置自动批准。任何范围需要自动启用前，必须先通过已认证的企业控制平面配置并治理对应资源策略。

</details>

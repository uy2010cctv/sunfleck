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

面向企业 Profile 的已审核企业记忆上下文。插件通过企业工作区授权解析 Session cwd，注入共享组织/部门隔间、锚定会话私有的 agent 与 pair 隔间，以及项目服务确认会话行为人成员资格后的项目隔间的已批准摘要。数字员工身份是独立于 Agent Preset 工作方式的 Session 绑定；员工私有记忆按该身份读取，已学习能力文本按记录的发布版本读取。插件不会加载原始对话正文、待审核/已驳回条目或这些隔间之外的记忆。

启用自动业务记忆采集时，写入者依次取已认证请求主体和持久化的企业 Session 所有者。未绑定的后台运行必须配置已存在、且以 `service:` 开头的 `backgroundServiceUserId`；绝不会回退为 bootstrap 管理员。已确认的常规知识直接启用，不确定或冲突内容保持待确认。个人工作区偏好不会被提升为共享记忆。

记忆值以带稳定 ID 的事实背景呈现，并附带明确的隐私与访问规范。隐私筛查、范围检查和停用记录仍是权威。员工学习是独立的版本化资产工作流，不会改变业务记忆策略。

## 记忆启用

已确认的常规知识经 remember_business_knowledge 直接启用；`needsConfirmation=true` 把不确定或冲突的知识保持为待确认。工作区与行为人隔离、隐私检查、来源摘要、审计与停用记忆保护仍然生效，每条记忆无需单独的管理员策略授权。

## 轮后自动沉淀

启用 `autoSave` 与 `writebackEnabled` 后，每轮回答结束时先把有界的直接用户消息和最终回答写入 PostgreSQL 队列，再由独立模型在后台提取企业记忆。主 Agent 无需主动调用记忆工具，提取状态也不会伪装成用户消息。

每个候选记忆都带一个 `target` 分区：默认 `private`；仅当用户明确表达协作偏好时取 `pair`；只有明确的公司级或部门级可复用事实才取 `organization` 或 `department`。`private` 与 `pair` 候选在处理时经 `ctx.employeeAccounts` 解析会话归属后免审核直写对应分区，解析不到则跳过。共享分区维持既有审核路径：精确重复跳过，高置信度且无冲突的知识直接启用，不确定、低置信度或冲突内容进入待确认。提示注入与超长摘要在任何分区都会丢弃；含 `personal-preference` 的候选降级写入本人的 agent 分区，绝不进入共享记忆。每次回写重新核验工作区与会话所有者。失败按 5、15、60、180 秒退避，最多自动尝试五次；成功后删除队列里的对话副本，只保留结果计数、记忆编号、时间和来源。管理台“自动沉淀”区域显示处理中、失败、最近结果和重试入口。

## 记忆整理

只要企业 PostgreSQL 平台已挂载，即可按分区运行整理：把重复组归并到最新一条、把其余已启用记忆的重要度改写为衰减值、在宽限期后停用衰减到阈值以下的记忆，并为每个共享分区提炼一条 `summary` 摘要。衰减写入不动访问时钟，因此既未被召回也未被触碰的记忆会在每次整理时重新叠加完整的锚点龄期，以快于半衰曲线的速度衰减直至停用；只有召回会同时重置时钟与衰减。摘要在写入前经过分区感知的隐私门禁，通过后立即生效（整理是 `summary` 行的权威写入方）并取代上一条生效摘要；与在生摘要相同的结果记为 `unchanged`，而重新生成一条管理员已拒绝的相同文本会因确定性编号冲突而响亮失败。organization 范围的整理还会把仍有足够重要度的已批准 agent 私有笔记提炼为 `business-fact` 反思提案等待管理员审核；被目标分区隐私门禁拦截的提案直接丢弃，department 目标的提案因缺少作者部门解析服务而暂不可用。

定时路径只处理 `consolidationOrgIds` 列出的组织（默认为空，即默认关闭），间隔 `consolidationIntervalMs`（默认 6 小时，`0` 表示关闭）；启用定时段落要求配置 `consolidationActorUserId`（`service:` 身份）、`consolidationProvider` 与 `consolidationModel`。手动触发端点 `POST /enterprise/consolidation/run` 按 `memory.manage` 策略按需整理一个分区；同一分区已有运行在途时返回 409。同进程内对同一分区做在途保护，因此定时路径只能在单台主机上启用。每个阶段都会追加一条审计记录；`consolidationTunables` 可覆盖各项阈值。

## 项目记忆工具与结项蒸馏

`memory_write` 支持 `scope: "project"`：会话 actor 锚定到项目时，项目必须存在于会话组织内且处于 active 状态，解析出的用户必须是项目成员，写入直接落为已启用（成员制空间免审查），并与其他共享分区一样经过分区感知隐私门禁——任何拦截性发现都会成为工具错误。project 范围只接受 `business-fact | process | terminology | decision`；`memory_search` 与 `memory_read` 对同样的成员会话暴露项目分区。

`distillProject` 在结项时闭环：把项目分区中已批准的非 summary 记忆提炼为至多五条共享记忆的 `business-fact` 经验提案，每条按目标分区做隐私分类（被拦截的丢弃并计数；department 目标与反思一致暂不可用），并等待管理员审核。经验编号按内容确定，重复蒸馏会跳过已存在的条目。可通过控制器端点 `POST /enterprise/projects/:id/distill`（成员门禁）触发，或在项目归档时自动触发——归档响应从不等待蒸馏。缺少 `llm` 服务、精炼调用失败或分区为空都会返回结构化报告而不是错误。

## Model Experience

### 已批准的企业记忆

#### What the model sees

只呈现会话授权解析出的隔间（组织、部门、自己的 agent 与 pair、按成员准入的项目）中已批准的摘要。每项注入内容带稳定 `memoryId` 和范围；个人偏好与原始对话内容被排除。

#### Token effect

注入摘要在配置的条目与字符上限内消耗 Prompt Token。

#### KV Cache effect

已批准记忆保持有序且未变化时可能提高复用；实际缓存行为由 provider 决定。

### 员工自主学习

#### What the model sees

企业配置默认挂载独立的 `./learning` 插件。员工完成可复用工作后调用 `learn_employee_capability`，传入类型、名称及工作区内的 Markdown 源文件路径，即可自动登记、绑定自身并发布能力版本，无需管理员确认。归属取独立的 Session 员工绑定；历史会话仍可从员工 preset 读取。原有能力和未发布的人工草稿会保留。新会话只加载所选员工在该工作区学到的能力；已打开的会话固定到记录的发布版本。学习指令仅对已发布员工进入提示词，不新增工具权限或数据访问权限。`maxLearningBytes` 限制每个源文件（默认 64000 个 UTF-8 字节）；`maxChars` 限制学习内容上下文，较长规程通过源文件按需读取。

#### Token effect

注入的学习指令最多消耗配置的 `maxChars`；较长规程只贡献简短源引用，供按需读取。

#### KV Cache effect

按版本固定的学习内容在员工发布下一个能力版本前保持稳定，可能保留提供方的前缀复用。

## Known Limitations and Deferred Work

- 本包只沉淀简洁的企业业务记忆；Markdown 文档、笔记、任意文件和远程知识客户端属于独立的文档知识库能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

企业 Profile 默认启用轮后自动沉淀。任何提取都必须保留会话、轮次、工作区和操作者来源，冲突不得静默覆盖已启用内容。

</details>

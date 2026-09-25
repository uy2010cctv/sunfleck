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

`GET /enterprise/session-context/:sessionId` 返回 Session 固定的员工发布版本、明确成员所属项目和已授权批准摘要，不启动运行时。员工选择独立于工作方式预设，并校验持久化所有者与组织。私有摘要要求仅所有者可访问的普通 Session，且员工选择或账号锚定匹配；协作 Session 不返回员工私有及双边摘要。双边记忆同时要求员工和用户编号；缺少员工归属的旧双边条目不返回。

仅在企业 Profile 中，并在 `enterprisePostgres`、`enterpriseSecurity`、`enterpriseRequestContext` 和 `sessionController` 之后挂载本 Controller。Client 通过 API Gateway 使用生成的 `enterpriseEmployee`、`enterpriseAsset`、`enterpriseTeam`、`enterpriseTeamDefinition`、`enterpriseTeamRun`、`enterpriseTeamDecision`、`enterpriseTeamAutonomy`、`enterpriseOperation`、`enterpriseWork` 和 `enterpriseDevice` namespace。TeamRun start 和 cancel namespace 使用可选 `enterpriseTeamRuntimeDriver`；没有 provider 时，start 返回稳定 runtime-unavailable 失败。设备配对和 Computer Use 请求同时绑定已认证用户、Workspace、Session、短期操作 Permit 和设备签名。Host 注入组织与 actor 身份，browser 请求不能写 runtime revision 或 event position。本包不替代 DSH 的 Workspace、Session、Workflow、Sandbox、Subagent 或 Agent Loop 身份。

`enterpriseTeamDefinition` 将章程编辑与可执行历史分开：`draft` 追加不可变修订，`getDraft` 只向负责人可见地返回当前草稿而不替换 active 章程，`publish` 为后续 Run 提升一份已校验草稿，`discardDraft` 只归档该草稿。每个端点都使用既有 `team.read` 或 `team.manage` 策略与审计链路；调用者不能提供组织或 actor 身份。

`cordisWorkspace` 读取使用已认证主体过滤私有 Package 和绑定。`archive` 与 `restore` 只操作该主体在指定 Workspace 内拥有的 Plugin；归档保留不可变源码并停止新 Session 激活。`cordisReview.submitSaved` 只接受创建者在部门 Workspace 中的私有版本，另建待审记录而不启用。部门批准与组织发布继续分别遵循负责人和管理员权限。

员工发布会先写入不可变目录版本，再维护原生 Agent Preset 声明，供历史 Session 回放和员工列表展示。Preset 写入遇到瞬时失败会重试一次。持续失败时会明确说明目录版本已经发布并要求重试同步；未变化的已发布草稿会返回同一个版本。Host Loader 结算后，控制器将每个已发布员工的最新声明重建到注册表。注册表在列出、读取、选择或绑定员工声明前按已认证主体核对员工目录权限；Host 内部仍能回放已提交的旧 Session。

`enterpriseWork.workspaceDefault` 返回调用者可安全读取的工作区默认员工和 CAS revision。`saveWorkspaceDefault` 在校验工作区与已发布员工权限后，允许个人所有者、部门经理或组织管理员设置或清除默认值。员工不可见或不可用时，返回 `employeeId: null` 和 `unavailable: true`；有权访问工作区的成员仍可读取存储的 revision。新 Session 先选择通用 Agent Preset 作为工作方式；`selectEmployee` 再校验 Session 所有权、工作区授权、员工可见性和空白会话状态，独立记录员工身份与不可变发布版本。员工提示词在该 Agent 中覆盖工作方式的身份提示词，工作方式的其他插件继续运行。回放恢复同一发布版本，员工自学习与私有记忆读取独立员工绑定。目标优先的启动路径使用配置的默认工作方式，另行绑定选定员工版本。仅选择员工不会创建工作记录或启动任务。

`/enterprise/surfaces` 的 PostgreSQL 协作路由支持显式成员列表、群聊与频道创建、详情、`/by-session/:sessionId` 恢复、原生目标会话打开和文本投递。创建支持按认证组织及创建者隔离的可选 `idempotencyKey`：解析值相同则复用已保存会话，不同则返回 409 且不写入。创建要求已有可访问工作区、可访问该工作区的显式人员成员，以及可见的已发布员工。详情与打开操作均先验证成员和工作区权限。原生 `session.prompt` 在重新加载后仍使用同一路由，并返回授权的响应 Session 标识供导航。团队重试先检查持久化请求回执，再按生命周期路由，因此运行完成或等待人工时仍复用原回执；员工目标通过 `enterpriseWork.start` 绑定准确的已发布版本，恢复时保留独立的基础工作模式预设。群聊中的 @ 匹配包括空格在内的完整成员名称，并优先采用最长有效名称投递到员工会话，已有原生会话中的未提及消息只记录而不启动员工。频道按话题和值班策略路由，每个话题与员工组合保留独立原生会话，`/done` 结束话题。公告频道通过隐私检查后写入组织记忆提案，不启动 Agent。附件明确拒绝。消息保留原生请求标识、协作标识和认证发送者。员工私聊及令牌入站路由仍需单独装配服务；项目路由保留成员校验、归档和可选记忆提炼。

共享房间事件签名为每个组织的人类、数字员工或服务主体使用独立的服务器托管 NIP-01 密钥。私钥保存在 `ctx.credentials` 记录中；PostgreSQL 将主体绑定到首个公钥，私钥丢失或变化时拒绝签名。签名前检查当前房间访问权和员工 Session 绑定。用户自行持有密钥并签名的流程尚未实现，因此人类签名目前由服务器托管。签名事件格式不表示已支持外部 Nostr Relay 客户端。

群聊和频道从 `GET /enterprise/surfaces/:id/events` 与 `.../search` 读取同一条签名房间时间线。认证后的发帖和表情先落库再派发给 Bot；原生执行 Session 记录房间来源编号和有界的模型可见房间历史。Bot 回复、任务交接、TeamRun 事实及人类决策以核实后的作者身份回到房间。频道管理员通过 `/enterprise/channel-workflows` 保存版本化的声明式 YAML。消息和表情触发器消费已落库的房间事件；定时触发器使用 PostgreSQL 租约回执。精确路径 `/enterprise/channel-workflows/github` 需要配置 GitHub 密钥引用，验签后将匹配的 tag、代码评审、合并或 Webhook 来源事件持久化，再返回 202。工作流步骤生成签名房间事实并复用企业审批；后续动作等待人类作出决定。

由房间消息触发的员工 `tool/call` 与 `tool/result` 还会生成签名的房间操作记录。记录仅包含有界工具名称、成功或失败状态及原生 Session 来源游标；原始参数、结果内容和工具元数据只保留在有权限读取的原生 Session 中。

签名房间事件与其投递目标在同一事务写入 PostgreSQL 发件箱。即时投递和重启恢复通过带租约令牌的领取操作，再次检查当前成员与工作区权限，并仅在原生 Session 接受请求后确认。工作流消息触发另有持久收件箱；未完成触发或已提交审批在重启后重试。频道详情读取待审批摘要，批准或驳回时使用审批自身的 CAS 修订号。

工作流触发收件箱在签名房间事件提交时固定对应 YAML 修订版，重放不会换用之后的编辑。工作流动作与审批续跑使用租约令牌。专用 GitHub 入口验签原始请求，等待频道签名回执落库后才返回 202；失败返回 503 供来源重试。已落库的人类审批可由当前仍获授权的审批人续跑；若审批人撤权，则由有权限的频道管理员续跑，并由服务身份签名证明先前已记录的裁决。

<a id="model-experience"></a>
## 模型体验

### 企业控制 API

#### What the model sees

协作投递把认证用户消息作为 `user/message` 记录到选定的原生 Session。员工提及和值班路由使用与普通工作相同的 Agent 预设和会话历史。

#### Token effect

元数据操作不增加模型 Token。每条协作投递消息进入原生会话历史，使用常规员工提示词与历史的 Token 预算。公告摄取采用确定性的记忆提案路径。

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

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

`GET /enterprise/session-context/presented/:sessionId` 在检查 Session 访问权或房间成员身份后，返回声明交付的文件路径及其原生事件序号和文件索引下载坐标。若文件所属的完整原生轮次存在房间回复，每项包含 `replySourceSeq`；服务从完整 Session 日志推导该序号，不受房间分页影响。

`GET /enterprise/session-context/:sessionId` 返回 Session 固定的员工发布版本、明确成员所属项目和已授权批准摘要，不启动运行时。员工选择独立于工作方式预设，并校验持久化所有者与组织。私有摘要要求仅所有者可访问的普通 Session，且员工选择或账号锚定匹配；协作 Session 不返回员工私有及双边摘要。双边记忆同时要求员工和用户编号；缺少员工归属的旧双边条目不返回。

仅在企业 Profile 中，并在 `enterprisePostgres`、`enterpriseSecurity`、`enterpriseRequestContext` 和 `sessionController` 之后挂载本 Controller。Client 通过 API Gateway 使用生成的 `enterpriseEmployee`、`enterpriseAsset`、`enterpriseTeam`、`enterpriseTeamDefinition`、`enterpriseTeamRun`、`enterpriseTeamDecision`、`enterpriseTeamAutonomy`、`enterpriseOperation`、`enterpriseWork` 和 `enterpriseDevice` namespace。TeamRun start 和 cancel namespace 使用可选 `enterpriseTeamRuntimeDriver`；没有 provider 时，start 返回稳定 runtime-unavailable 失败。设备配对和 Computer Use 请求同时绑定已认证用户、Workspace、Session、短期操作 Permit 和设备签名。Host 注入组织与 actor 身份，browser 请求不能写 runtime revision 或 event position。本包不替代 DSH 的 Workspace、Session、Workflow、Sandbox、Subagent 或 Agent Loop 身份。

`enterpriseTeamDefinition` 将章程编辑与可执行历史分开：`draft` 追加不可变修订，`getDraft` 只向负责人可见地返回当前草稿而不替换 active 章程，`publish` 为后续 Run 提升一份已校验草稿，`discardDraft` 只归档该草稿。每个端点都使用既有 `team.read` 或 `team.manage` 策略与审计链路；调用者不能提供组织或 actor 身份。

`cordisWorkspace` 读取使用已认证主体过滤私有 Package 和绑定。`archive` 与 `restore` 只操作该主体在指定 Workspace 内拥有的 Plugin；归档保留不可变源码并停止新 Session 激活。`cordisReview.submitSaved` 只接受创建者在部门 Workspace 中的私有版本，另建待审记录而不启用。部门批准与组织发布继续分别遵循负责人和管理员权限。

员工发布会先写入不可变目录版本，再维护原生 Agent Preset 声明，供历史 Session 回放和员工列表展示。Preset 写入遇到瞬时失败会重试一次。持续失败时会明确说明目录版本已经发布并要求重试同步；未变化的已发布草稿会返回同一个版本。Host Loader 结算后，控制器将每个已发布员工的最新声明重建到注册表。注册表在列出、读取、选择或绑定员工声明前按已认证主体核对员工目录权限；Host 内部仍能回放已提交的旧 Session。

`enterpriseWork.workspaceDefault` 返回调用者可安全读取的工作区默认员工和 CAS revision。`saveWorkspaceDefault` 在校验工作区与已发布员工权限后，允许个人所有者、部门经理或组织管理员设置或清除默认值。员工不可见或不可用时，返回 `employeeId: null` 和 `unavailable: true`；有权访问工作区的成员仍可读取存储的 revision。新 Session 先选择通用 Agent Preset 作为工作方式；`selectEmployee` 再校验 Session 所有权、工作区授权、员工可见性和空白会话状态，独立记录员工身份与不可变发布版本。员工提示词在该 Agent 中覆盖工作方式的身份提示词，工作方式的其他插件继续运行。回放恢复同一发布版本，员工自学习与私有记忆读取独立员工绑定。目标优先的启动路径使用配置的默认工作方式，另行绑定选定员工版本。仅选择员工不会创建工作记录或启动任务。

`/enterprise/surfaces` 的 PostgreSQL 协作路由支持显式成员列表、群聊与频道创建、详情、`/by-session/:sessionId` 恢复、原生目标会话打开和文本投递。创建支持按认证组织及创建者隔离的可选 `idempotencyKey`：解析值相同则复用已保存会话，不同则返回 409 且不写入。创建要求已有可访问工作区、可访问该工作区的显式人员成员，以及可见的已发布员工。详情与打开操作均先验证成员和工作区权限。原生 `session.prompt` 在重新加载后仍使用同一路由，并返回授权的响应 Session 标识供导航。团队重试先检查持久化请求回执，再按生命周期路由，因此运行完成或等待人工时仍复用原回执；员工目标通过 `enterpriseWork.start` 绑定准确的已发布版本，恢复时保留独立的基础工作模式预设。群聊中的 @ 匹配包括空格在内的完整成员名称，并优先采用最长有效名称投递到员工会话，已有原生会话中的未提及消息只记录而不启动员工。频道按话题和值班策略路由，每个话题与员工组合保留独立原生会话，`/done` 结束话题。公告频道通过隐私检查后写入组织记忆提案，不启动 Agent。房间附件以原始字节通过 `POST /enterprise/surfaces/:id/attachments?name=&type=` 上传（单文件 20 MB 上限、每条消息最多 8 个），当前成员经 `GET /enterprise/surfaces/:id/attachments/:attachmentId` 按成员范围下载；消息事件签入每个附件的标识、名称、媒体类型和大小，员工提示词会列出文件名。房间输入框在签名事件与投递队列持久化后收到消息回执；恢复作业独立启动员工 Session。原生 Session 输入框仍返回同步的目标回执。消息保留原生请求标识、协作标识和认证发送者。员工私聊及令牌入站路由仍需单独装配服务；项目路由保留成员校验、归档和可选记忆提炼。

创建群聊或频道的人员在保持当前成员资格与工作区访问权限时担任管理员。只有管理员可以重命名（`POST /enterprise/surfaces/:id/rename`）、替换或清除公告（`.../announcement`，携带 `text`）、增删成员（`.../members/add` 与 `.../members/remove`，携带可选 `memberEmployeeIds` 与 `memberUserIds`），以及归档（`.../dissolve`）。`GET .../member-options` 仅返回不在当前成员名单中的可用工作区人员与当前用户有权使用的已发布员工的最少信息。新增人员需要工作区访问权限，新增员工需要可见的已发布版本。候选成员失效时返回 409，房间仍可访问。管理员不能移除自己或退出，其他成员可以通过 `POST .../leave` 退出。退出与归档分别返回 `{ id, left: true }` 与 `{ id, archived: true }`，不会重新读取已不可访问的详情；归档保留内容。频道通过 `POST .../duty` 与 `{ "employeeIds": [...] }` 显式设置值班员工，选择仅限当前可见员工成员，选择失效时返回 409；移除员工会原子移除其值班引用，不自动指定替代员工。没有记录管理员的存量房间不暴露管理入口。详情返回 `viewerIsAdmin`、`adminUserId` 与 `announcement`。

有权限的房间列表行提供 `attention.newMessages` 和 `attention.mentions`，表示认证用户的持久已读游标之后的签名消息。`GET /enterprise/surfaces/:id/events` 返回精确序号；客户端展示该页后，以 `{ "sequence": "..." }` 调用 `POST /enterprise/surfaces/:id/read`，响应返回同一序号。空页不推进游标。人类消息或 Agent 的 `room_post` 可传 `mentionedUserIds`，服务先检查当前成员身份，再写入签名的 `dsh-mention` 标签。房间详情包含有权限查看的人类成员显示名，以 `viewerUserId` 标识认证用户，并携带每位员工成员已发布的 `avatarSeed`，客户端据此高亮本人发言并渲染成员头像。

按成员权限过滤的房间列表包含各房间的 Workspace、绑定的原生执行 Session 编号以及可选的项目和章程引用，客户端据此分组，并从工作区浏览中省略执行行，无需读取全组织目录。当前 Workspace 授权不通过的会话不会进入列表。新房间只能关联创建者已加入的进行中项目。`GET /enterprise/projects/:id` 在项目成员校验后返回持久化成员名册，重新打开项目详情时不再根据浏览器操作推测成员。

企业 Profile 的 `POST /enterprise/projects` 接收名称和目标。控制器在 `projectWorkspaceRoot` 下选择目录、注册原生 Workspace、原子准备项目授权，最后提交项目；响应包含 Workspace 编号。新增成员后会向有权限的订阅者重新发布该工作区。已归档项目仍可读取，但不能在其工作区启动新 Session。

共享房间事件签名为每个组织的人类、数字员工或服务主体使用独立的服务器托管 NIP-01 密钥。私钥保存在 `ctx.credentials` 记录中；PostgreSQL 将主体绑定到首个公钥，私钥丢失或变化时拒绝签名。签名前检查当前房间访问权和员工 Session 绑定。用户自行持有密钥并签名的流程尚未实现，因此人类签名目前由服务器托管。签名事件格式不表示已支持外部 Nostr Relay 客户端。

群聊和频道从 `GET /enterprise/surfaces/:id/events` 与 `.../search` 读取同一条签名房间时间线。认证后的发帖和表情先落库再派发给 Bot；原生执行 Session 记录房间来源编号和有界的模型可见房间历史。Bot 回复、任务交接、TeamRun 事实及人类决策以核实后的作者身份回到房间。绑定群聊的员工 Session 可以创建 Host 定时任务；认证后的 `GET /enterprise/surfaces/:id/schedules` 只列出本群现有员工的活动任务，群管理员可通过 `.../schedules/delete` 删除指定任务。Host Schedule 唤醒的工作完成后，服务端重新核对当前群成员与工作区权限，再将带 `dsh-schedule` 标记的员工签名回复写回原群。频道管理员通过 `/enterprise/channel-workflows` 保存版本化的声明式 YAML。消息和表情触发器消费已落库的房间事件；定时触发器使用 PostgreSQL 租约回执。精确路径 `/enterprise/channel-workflows/github` 需要配置 GitHub 密钥引用，验签后将匹配的 tag、代码评审、合并或 Webhook 来源事件持久化，再返回 202。工作流步骤生成签名房间事实并复用企业审批；后续动作等待人类作出决定。

频道 Agent 的 `room_post` 回复保留触发消息的原始线程父消息，回复已有回复时也沿用该父消息。`GET /enterprise/surfaces/:id/events?threadRoot=...` 独立于回复分页，以 `root` 返回有权限读取的签名父消息；父消息不存在、不是文本消息，或将回复当作父消息时返回 404。采用线程主题策略的频道，还将绑定到该根消息的原生 Session 中历史未分线程的员工记录及针对这些记录的人类回应纳入回复页；响应视图带有父消息，签名事件与存储记录保持不变。对历史文本回复的新回应，通过目标消息的原生 Session 绑定解析父消息，并将其写入签名及存储。

由房间消息触发的员工 `tool/call` 与 `tool/result` 还会生成签名的房间操作记录。在频道中，其签名根标签和存储的线程父消息与触发消息的原始父消息一致。记录仅包含有界工具名称、成功或失败状态及原生 Session 来源游标；原始参数、结果内容和工具元数据只保留在有权限读取的原生 Session 中。

房间上传附件只有被本次触发的签名事件引用，才会在员工 Session 接受请求前转为原生文件或图片部件。接纳过程重新检查当前成员身份及存储元数据，通过工作区附件服务原样存储文件，并采用该服务的图片校验与当前模型的输入模态限制。历史房间上下文中的附件标签不会额外接纳上传文件。图片输入无效或当前模型不兼容时，先记录唯一的 `attachment-admission` 服务签名事实，携带 `dsh-attachment-error` 错误码、目标及来源事件，再结束投递；存储和传输故障仍可重试。

签名房间事件与其投递目标在同一事务写入 PostgreSQL 发件箱。即时投递和重启恢复通过带租约令牌的领取操作，再次检查当前成员与工作区权限，并仅在原生 Session 接受请求后确认。工作流消息触发另有持久收件箱；未完成触发或已提交审批在重启后重试。频道详情读取待审批摘要，批准或驳回时使用审批自身的 CAS 修订号。

工作流触发收件箱在签名房间事件提交时固定对应 YAML 修订版，重放不会换用之后的编辑。工作流动作与审批续跑使用租约令牌。专用 GitHub 入口验签原始请求，等待频道签名回执落库后才返回 202；失败返回 503 供来源重试。已落库的人类审批可由当前仍获授权的审批人续跑；若审批人撤权，则由有权限的频道管理员续跑，并由服务身份签名证明先前已记录的裁决。

<a id="model-experience"></a>
## 模型体验

### 企业控制 API

#### What the model sees

协作投递把认证用户消息作为 `user/message` 记录到选定的原生 Session。员工提及和值班路由使用与普通工作相同的 Agent 预设和会话历史。Bot 调用 `room_post` 时，明确的 `@显示名`、`@ALL` 和行首的中文指派（如 `给 某员工：`）根据当前房间员工名册解析，在签名消息提交后唤醒被点名的同事；显式传入的 `targetEmployeeIds` 优先，空数组表示不唤醒 Bot。普通正文提到姓名不会唤醒员工。发帖 Bot 不会唤醒自己，签名跳数限制约束后续 Bot 请求。群聊会话冷启动时从持久员工选择恢复群聊工具，并在每次模型请求中加载当前定时协作指令。群聊定时回合可省略 `sourceEventId` 或传入空字符串，调用 `room_post` 请当前成员协作；Host 用本次定时输入签名消息，并将重试键限定在本次触发内。定时回合不能复用先前的人类群消息作为来源；Host 也会把该回合的最终回复投影回群聊。有界房间输入要求员工创建请求的交付文件，并在最终回复前调用 `present`；向外部会话发送消息需要明确请求。

#### Token effect

元数据操作不增加模型 Token。每条协作投递消息进入原生会话历史，使用常规员工提示词与历史的 Token 预算。公告摄取采用确定性的记忆提案路径。

#### KV Cache 影响

在已发布员工启动普通 DSH Session 之前没有影响。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

章程房间的 TeamRun 首次输入和后续输入仅接受文本，因此带附件的帖子会在签名前以 `team-attachments-unavailable` 拒绝。普通员工房间将 PNG、JPEG、WebP 和 GIF 作为图片接纳；包括 SVG 在内的其他媒体类型均保留为原样文件。

- 首个企业 Profile 面向单组织和单套 PostgreSQL 部署。
- 企业实时失效事件不能替代重连后读取权威 Repository。
- 本包不提供具体 Agent Teams runtime driver、TeamRun UI 或渠道 adapter。
- 公开的 `EnterpriseWorkPrepareRequest`、`EnterpriseWorkStartRequest`、`EnterpriseWorkPreparation` 和 `EnterpriseWorkStartValue` contract 从包根和 `./types` 导出。
- `enterpriseWork.prepare` 按显式、调用者拥有的 Session、已授权最近提示、个人工作区的顺序解析已授权工作区。隐式个人工作区仅在恰有一个调用者拥有且仍然已授权、可见的工作区时自动采用；否则返回含已授权可见工作区 ID 的 `needs-workspace-selection`。单个已发布 preset 时自动选择其最新 release，多个 preset 时返回 `needs-selection`。`start` 从组织、用户和幂等键派生不透明 SHA-256 Session ID，随后在原生 Session 创建或绑定之前，原子性地把 canonical 请求指纹、不可变 release ID 与已解析的 Session 输入预留到 Enterprise Operations。以同一键传入变更后的输入会在副作用之前冲突；`starting` reservation 允许同一请求在 WorkRecord 写入失败后继续恢复，且 reservation 只会在 upsert 后标记为 `completed`。它只保存目标摘要和可选的允许截止日期，不做模型或能力路由、不创建团队、不接收附件、不分配预算，也不创建自主权授权。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

[群聊定时协作录制会话](../../../snapshots/session/group-schedule-cooperation/)通过随附的 headless profile 固定群聊工具 schema、当前协作指令与定时来源发帖行为。

新增方法时须保持所有 Remote payload 可安全 JSON 序列化，并保留授权与审计调用。工作启动的幂等性必须让不透明的确定性 Session-ID 派生仅使用组织、用户和幂等键；在原生副作用前把 canonical 请求指纹、不可变 release ID 与已解析的 Session 输入预留到 Enterprise Operations，不得在 Session ID 中暴露请求值，reservation 指纹不同的复用键必须拒绝，并且仅在 WorkRecord 持久化后完成 reservation。

</details>

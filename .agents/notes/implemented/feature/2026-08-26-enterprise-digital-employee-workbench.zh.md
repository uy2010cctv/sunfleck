# Agent Note: 企业数字员工运营台

Status: implemented

[English](2026-08-26-enterprise-digital-employee-workbench.md) | 中文

## 问题

DSH 把 Agent Preset、Workspace、Session 和 Session Event 作为独立的开发者概念暴露。企业运营者需要统一的员工名册与工作视图，但第二套员工或任务引擎会重复生命周期和审计状态，并最终与运行时分歧。

## 决策

企业运营层是 DSH 原生投影。已发布员工 Release 投影为可执行的 Agent Preset，Workspace 是业务空间，Session 是工作记录，Session Event 继续作为运行时审计事实来源。[员工与工作方式的归属](../architecture/2026-09-25-digital-employee-and-agent-mode-ownership.zh.md) 负责独立的浏览器入口和工作区默认值。

浏览器界面只做增量组合：一个 Sidebar 底部动作和一个框架级 overlay。开始工作委托给 `SessionRuntime.create({ agentPreset })`；选择既有工作时打开原 Session。企业包不重复存储工作生命周期。

## Preset 元数据

已发布目录 Release 提供员工展示和运行时 Persona 字段。稳定的 preset id 保持身份；能力标签不授予工具或权限。普通 Agent Preset 声明仍是工作方式。

## 受管员工创建

企业员工名册为空时必须提供主要操作“新建数字员工”，不能停在无下一步的空状态。编辑器先创建一个未保存的 revision 0 草稿，并隐藏系统生成的内部 id。首次通过校验并保存时，DSH 以该稳定 id 复制部署默认 Agent Preset，再持久化企业员工草稿；后续保存使用 revision CAS，发布时冻结不可变 Release。这样创建出的员工仍通过原生 Session `agentPreset` 链运行，而不是只有目录记录、无法发起对话的空壳。

每位员工档案保存一个不含个人信息的 `avatarSeed`。新草稿随机生成 seed，旧记录在没有 seed 时使用稳定的 Preset id。浏览器通过 DiceBear Lorelei HTTP API 渲染头像，不会把姓名、邮箱、Prompt 或组织数据发送给头像服务。Lorelei 是 CC0 授权的 remix；头像只属于展示元数据，不参与运行时身份判定。

员工编辑器通过当前登录会话读取 `/auth/departments`，并保存用户选择的规范部门名称。普通已登录成员按员工读取权限使用该目录；新建部门和调整组织树仍只属于管理员。表单采用名称整行、岗位与部门成对、说明与 Prompt 整行的排布，同时移除头像下方的解释文案。

`EnterpriseWorkbench.module.css` 在工作台根节点、所有后代及伪元素上局部强制 `border-box` 尺寸规则。控件设置 `inline-size: 100%` 时，padding 和 border 会被包含在所属网格列内。数字员工、定时任务、能力资产、团队和扩展表单因此可共用响应式字段网格，相邻输入框不再重叠。

模型字段读取与对话输入框相同的实时 `session/modelCatalog`，并保存供应商/模型路由。“AI 优化”调用 `enterpriseEmployee.optimizePrompt`；Host 使用已选择且已配置的适配器，通过 `ctx.llm` 完成一次纯文本生成，不向浏览器暴露凭据。返回结果只替换本地未保存草稿，仍需用户显式保存并通过 revision fence 才会持久化。

发布校验允许直接使用这条已配置的供应商/模型路由，不再要求重复绑定一个企业 `model` 资产。历史草稿若引用固定版本模型资产，仍继续执行原有资产与版本校验。这样既与 DSH 实时 Provider 目录一致，也保留旧 Release 的不可变语义。

发布时还会把不可变 Release 中的身份编译进用户可写的原生 Agent Preset：姓名、说明、岗位、部门、能力标签与职责 Prompt 会同步到 `preset.yml` 和作用域内的 `@deepseek-ai/dsh-persona` 行。生成的 Persona 要求自我介绍必须基于数字员工身份，不得把自己说成通用编码 Agent 或 DSH 系统。Composition stamp 会为之后的 Session 创建新的 Preset 代际；已经运行的 Session 保留启动时代际。

员工编辑器与能力资产管理页使用同一套 5 类卡片分类：SOP、知识、技能、工具和 Cordis 扩展。前四张卡片筛选可创建或可绑定的版本化企业资产；Cordis 卡片进入现有扩展中心，因为 Cordis Package 保留自己的作用域、审核、Generation 与运行时生命周期。模型选择继续属于员工运行配置，不作为能力资产展示。卡片显示真实存储或已绑定数量，并从桌面端五列自适应回流到更小网格。

团队编辑器按员工 Preset 合并不可变 Release，每位员工只提供最新已发布版本。领队和成员都使用自适应身份卡选择，展示员工头像、岗位、部门和明确的 Release 版本；领队为单选，选定后会从成员候选中移除。保存时仍记录所选的不可变 Release id，因此后续发布新员工版本不会暗中改变已存在的团队定义。

## StaffDeck 来源边界

OpenBMB StaffDeck 只用于参考员工名册和运营信息架构。未复制 StaffDeck 的 React 组件、FastAPI 模型、插图、头像、Logo 或源文件。DSH 保留自身的 MIT 源码、Cordis 插件拓扑、运行时服务、事件日志、主题 token 和浏览器 slot 系统。

## 多用户边界

所选部署目标是单企业内网多用户。本功能建立员工与运营投影，但不会把当前 Host 误标为已认证的多用户基础设施。后续必须由经认证的身份和授权 Provider 强制执行记录可见性与管理动作，才能宣称该部署目标已完成。`trustedHosts` 和 loopback 检查仍只是 DNS rebinding/可达性控制，不是身份认证。

## Channel Kernel

`@deepseek-ai/dsh-channel-kernel` 建立与提供方无关的命令、Sticky Employee、意图/默认路由、规范渠道身份、入站幂等、重试时间、Token/心跳健康、Session 自愈和脱敏消息审计合同。个人微信和企微 Bot 的登录、传输、持久 inbox/outbox 存储和提供方回执仍属于适配器职责。内核路由到原生 Session，不创建另一个会话存储。

## 企业治理内核

`@deepseek-ai/dsh-enterprise-governance` 建立组织优先授权、管理员/创建者/运营者/审计员/成员角色、员工和 Session 可见性、部署就绪与可归因审计合同。它不认证用户，也不存储密钥。在部署适配器提供身份、RBAC、加密凭据、持久审计、单端口打包和 Public TLS 证据之前，LAN 和 Public 部署仍被阻止。

## 已认证企业部署

可选企业 Overlay 用 AES-256-GCM Envelope 存储替换受管明文 Credential Provider，挂载 SQLite 身份/会话/资源策略/审计持久化，并在同一 Web 端口通过 `/auth` 提供本地和 OIDC/SAML/LDAP 登录。存在 `ctx.enterpriseSecurity` 时，Connection 载体会认证并授权每个共享 HTTP RPC、Typert 端点、独立 RPC Channel 和 WebSocket 下行；未知端点失败关闭。浏览器增加全帧登录 Gate 和仅管理员可见的组织/用户/角色/资产策略/审计账本。

部门共享工作区始终绑定不可变的部门 id。部门改名时，系统生成的“部门名 · 共享工作区”会同步新名称；管理员自定义的工作区名称会被保留。管理员在工作区管理页中通过一次显式、受 revision 保护的保存同时修改显示名称和沙盒策略，再把已提交名称同步到 DSH 原生 Workspace Registry，使侧边栏与治理页保持一致。不允许把工作区随意转绑到其他部门，因为 Session 可见性和部门记忆依赖该稳定归属边界。

外部 SSO 在实现上完成，但部署就绪依赖真实环境验证。协议库与模拟 Provider 测试证明 PKCE/state/nonce、SAML 签名/InResponseTo 配置、LDAP TLS/Filter/Bind 行为和规范 Claim 映射。它们不能证明客户真实 IdP Metadata、证书链、目录 Schema、Group 映射、TLS 终止或 Secret Manager 托管。

## 考虑过的替代方案

**独立的 StaffDeck 式员工后端。** 不采用，因为它会创建另一个任务、审计和员工身份平面，必须与 Session 和 Preset 同步。

**替换原生 Sidebar 和 Conversation。** 不采用，因为它会分叉 DSH 导航和执行行为，而不是与现有 slot 系统组合。

**把 trusted-host 检查称为多用户安全。** 不采用，因为可达性和 DNS rebinding 控制既不认证人员，也不授权记录。

**把提供方 SDK 和 RBAC 直接嵌入工作台 UI。** 不采用，因为传输和授权必须保护每个 Host 入口，而不只是一个浏览器界面。

**在普通开发 Web Profile 中启用认证。** 不采用，因为这会破坏现有 Loopback 开发流程，并把企业密钥缺失变成默认启动失败。企业安全是一个显式 Overlay，必需密钥材料失败关闭。

## 影响

- 运营台立即复用现有 Session 续接、回放、fork、Jobs、审批、subagent 和 workflow 事实。
- 员工元数据可在不迁移 Session 存储的情况下演进。
- 两套员工引擎之间不需要同步或冲突策略。
- 企业角色、审批箱、持久团队和跨用户授权仍是明确的后续能力，而不是只靠 UI 宣称的能力。
- 在选定提供方 SDK 或 SSO 系统之前，就可以测试渠道和治理策略。
- Desktop、LAN 和 Public 部署共用单端口 `/auth` 和 `/api` 传输；Public 仍需要部署 TLS。

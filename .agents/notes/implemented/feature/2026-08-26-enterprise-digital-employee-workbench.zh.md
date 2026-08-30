# Agent Note: 企业数字员工运营台

Status: implemented

[English](2026-08-26-enterprise-digital-employee-workbench.md) | 中文

## 问题

DSH 把 Agent Preset、Workspace、Session 和 Session Event 作为独立的开发者概念暴露。企业运营者需要统一的员工名册与工作视图，但第二套员工或任务引擎会重复生命周期和审计状态，并最终与运行时分歧。

## 决策

企业运营层是 DSH 原生投影。Agent Preset 是员工定义，Workspace 是业务空间，Session 是工作记录，Session Event 继续作为审计事实来源。

浏览器界面只做增量组合：一个 Sidebar 底部动作和一个框架级 overlay。开始工作委托给 `SessionRuntime.create({ agentPreset })`；选择既有工作时打开原 Session。企业包不重复存储工作生命周期。

## Preset 元数据

`preset.yml` 有一个可选的 `employee` 展示块，包含职位、部门和能力标签。这些字段明确不具有权威性：Preset id 仍是身份，已挂载的 composition 仍是能力和权限的权威来源。复制 Preset 时保留可复用的展示元数据，但仍丢弃源名称和 roster 顺序。

## 受管员工创建

企业员工名册为空时必须提供主要操作“新建数字员工”，不能停在无下一步的空状态。编辑器先创建一个未保存的 revision 0 草稿，并隐藏系统生成的内部 id。首次通过校验并保存时，DSH 以该稳定 id 复制部署默认 Agent Preset，再持久化企业员工草稿；后续保存使用 revision CAS，发布时冻结不可变 Release。这样创建出的员工仍通过原生 Session `agentPreset` 链运行，而不是只有目录记录、无法发起对话的空壳。

每位员工档案保存一个不含个人信息的 `avatarSeed`。新草稿随机生成 seed，旧记录在没有 seed 时使用稳定的 Preset id。浏览器通过 DiceBear Lorelei HTTP API 渲染头像，不会把姓名、邮箱、Prompt 或组织数据发送给头像服务。Lorelei 是 CC0 授权的 remix；头像只属于展示元数据，不参与运行时身份判定。

员工编辑器通过当前登录会话读取 `/auth/departments`，并保存用户选择的规范部门名称。普通已登录成员按员工读取权限使用该目录；新建部门和调整组织树仍只属于管理员。表单采用名称整行、岗位与部门成对、说明与 Prompt 整行的排布，同时移除头像下方的解释文案。

模型字段读取与对话输入框相同的实时 `session/modelCatalog`，并保存供应商/模型路由。“AI 优化”调用 `enterpriseEmployee.optimizePrompt`；Host 使用已选择且已配置的适配器，通过 `ctx.llm` 完成一次纯文本生成，不向浏览器暴露凭据。返回结果只替换本地未保存草稿，仍需用户显式保存并通过 revision fence 才会持久化。

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

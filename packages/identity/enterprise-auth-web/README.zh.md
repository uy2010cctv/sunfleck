---
description: "Enterprise Web authentication, session cookies, central API RBAC, and audit。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-auth-web`

[English](README.md) | 中文

## 概述

Enterprise Web authentication, session cookies, central API RBAC, and audit。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

持久 Web 认证与授权：

- `/auth` 状态、本地/SSO 登录、Callback、退出和管理端点。
- 使用哈希持久会话的 HttpOnly SameSite Session Cookie。
- 组合后，在每个 HTTP RPC、Typert 端点、独立 Channel 和 WebSocket 下行之前进行中央认证/RBAC/审计。
- `EnterpriseRequestContext` 是基于 `AsyncLocalStorage` 的服务，仅在已授权的 Host HTTP 与 WebSocket 工作期间暴露认证后的 `EnterprisePrincipal`。
- 组织、树状部门、用户成员关系、受管 Workspace/沙盒、已审核记忆、角色、停用、资源策略和审计管理 API。
- 在 Bootstrap/登录时创建默认受管个人 DSH Workspace，创建部门共享 Workspace，并允许成员在部署方受管根目录下新建个人 Workspace。
- 未知 Host 端点失败关闭。

企业 HTTP RPC payload 保留顶层 `principal` 键。会话认证后，传输层会在授权、审计或 dispatch 之前以 HTTP 400 拒绝该键，因此无效请求不会被记录为已允许，下游代码也只从 `ctx.enterpriseRequestContext.requirePrincipal()` 读取身份。未启用企业安全的 Profile 保持普通传输契约，仍可把该键作为应用数据使用。Plugin 卸载会禁用请求上下文，因此未完成的异步工作无法在卸载或重载之间保留 principal。

Web 插件接受部署方提供的 `EnterpriseIdentityStore` 实现。`databasePath` 仍可作为本地部署的可选 SQLite 后备；PostgreSQL 组合应通过该注入边界提供 仓库，Web 包本身不会再强制打开 SQLite。 该插件只关闭自己创建的 SQLite 仓库。外部提供的 `identityStore` 或 `enterprisePostgres.identity` 在 auth 卸载或初始化失败后仍归部署方所有。

`EnterpriseSecurity` 在应用共享层级策略前，为人类主体补充部门归属和负责部门。员工定义通过负责人的目录归属解析；绑定员工的渠道通过不可变发布版本解析到该定义。未绑定员工的渠道只对创建者可见，管理员仍可创建新渠道记录。记忆管理只列出组织记忆和已授权部门记忆，部门经理可维护本部门记忆，组织记忆变更保留给管理员。

## Model Experience

### Host 安全边界

#### What the model sees

无。`EnterpriseSecurity.authorizeApi` 在任何 Agent 可见操作执行前保护 Host 传输。

#### Token effect

无。允许后的下游能力自行承担之后的模型 Token 成本。

#### KV Cache effect

无；被拒绝调用不会到达模型请求，允许调用保持其所属能力的请求。

## Known Limitations and Deferred Work

- Public 部署仍需要 TLS 终止和 Secure Cookie 配置。
- 在真实端点和证书通过受控登录测试前，外部 SSO 就绪性仍属于部署环境事实。
- Web 包不会自行实例化数据库驱动；生产环境从企业组合接收异步 PostgreSQL 身份存储。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

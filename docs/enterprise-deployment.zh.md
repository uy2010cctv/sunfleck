# 企业安全部署

[English](enterprise-deployment.md) | 中文

普通 `dsh web` Profile 仍是 Loopback 开发 Profile。使用企业 Overlay 启用已认证的单企业模式：

```sh
export DSH_ENTERPRISE_MASTER_KEY='<base64 32-byte key>'
export DSH_ENTERPRISE_ADMIN_PASSWORD='<initial 12+ character password>'
export DSH_ENTERPRISE_DATABASE_URL='postgresql://user:password@db.internal:5432/dsh_enterprise'
export DSH_ENTERPRISE_WORKSPACE_ROOT='/srv/dsh-enterprise/workspaces'
pnpm dsh web --patch apps/cli/config/enterprise.cordis.patch.yml --host 127.0.0.1 --port 3081
```

在部署 Secret Manager 中生成和托管 `DSH_ENTERPRISE_MASTER_KEY`。不要把它与加密 Credential Document 存在一起。Overlay 使用 HMAC-SHA256 和域标签 `dsh-enterprise-catalog/cursor-signing/v1` 派生稳定的目录游标密钥；该密钥不会被持久化，也不会作为凭据加密密钥重用。轮换主密钥会使未完成的管理列表游标失效。初始管理员密码通过 Credential Seam 读取，仅在 Bootstrap Administrator 尚不存在时使用。

当前企业 Overlay 固定使用 `DSH_ENTERPRISE_DATABASE_URL` 的 PostgreSQL 生产组合，承载身份、Session、员工目录、运营和知识索引。数据库角色必须能安装 `pgvector` 和 `pg_trgm`，否则部署方必须预先安装两个 Extension。`credentials.enc.json` 只存储 AES-256-GCM Envelope。

`DSH_ENTERPRISE_WORKSPACE_ROOT` 是自动创建用户和部门 Workspace 时唯一允许使用的文件系统父目录。服务在 `users/` 和 `departments/` 下创建防路径穿越的哈希隔离区；用户不能通过企业创建端点提交 Host 路径。个人 Workspace 默认 `workspace-write`，部门 Workspace 默认 `read-only`，选定 DSH Session 的 cwd 继续作为沙盒强制执行边界。

共享记忆只保存已审核的业务摘要和 SHA-256 来源摘要。系统在审核前拒绝常见个人标识符、凭据形态文本、个人偏好和提示词注入短语，不保存来源原始对话。只有已批准的企业记忆和当前 Workspace 适用的部门记忆会投影进 Agent 上下文。

## SSO 配置

Provider 数组是 JSON 环境变量：

- `DSH_ENTERPRISE_OIDC`：Issuer、Client ID、Client Secret 引用、Callback、Claim/Group 映射。
- `DSH_ENTERPRISE_SAML`：Entry Point、Callback、Issuer、IdP 证书、Claim/Group 映射。
- `DSH_ENTERPRISE_LDAP`：LDAPS 或 StartTLS URL、Bind DN/密码引用、Base DN、已转义 User Filter、Attribute/Group 映射。

OIDC 必须使用 Authorization Code + PKCE/state/nonce。SAML 必须使用签名 Assertion、IdP 证书校验和 InResponseTo。LDAP 拒绝未使用 StartTLS 的明文传输，并在 Service Account 搜索后绑定被选中用户。

## 部署模式

- Desktop：绑定 Loopback；除非桌面 Shell 终止 HTTPS，否则保持 `secureCookies` 为 false。
- LAN：绑定 `0.0.0.0`，配置 Trusted Authority，使用已认证身份/RBAC/加密凭据/审计，并在凭据经过网络时终止 TLS。
- Public：TLS 是强制要求；设置 `DSH_ENTERPRISE_SECURE_COOKIES=true`，使用真实外部 IdP，通过 KMS/Secret Manager 保护 Master Key，并校验 Proxy Host/Origin 转发。

真实 OIDC/SAML/LDAP 生产就绪需要针对部署的实际端点、Metadata、证书链、Group 映射和目录进行受控登录。单元测试和模拟 Provider 测试不能建立该外部状态。

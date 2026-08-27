# 企业安全部署

[English](enterprise-deployment.md) | 中文

普通 `dsh web` Profile 仍是 Loopback 开发 Profile。使用企业 Overlay 启用已认证的单企业模式：

```sh
export DSH_ENTERPRISE_MASTER_KEY='<base64 32-byte key>'
export DSH_ENTERPRISE_ADMIN_PASSWORD='<initial 12+ character password>'
export DSH_ENTERPRISE_DATABASE_MODE='postgres'
export DSH_ENTERPRISE_DATABASE_URL='postgresql://user:password@db.internal:5432/dsh_enterprise'
pnpm dsh web --patch apps/cli/config/enterprise.cordis.patch.yml --host 127.0.0.1 --port 3081
```

在部署 Secret Manager 中生成和托管 `DSH_ENTERPRISE_MASTER_KEY`。不要把它与加密 Credential Document 存在一起。初始管理员密码通过 Credential Seam 读取，仅在 Bootstrap Administrator 尚不存在时使用。

生产组合使用 `DSH_ENTERPRISE_DATABASE_MODE=postgres` 和 `DSH_ENTERPRISE_DATABASE_URL`，PostgreSQL 承载身份、Session、员工目录、运营和知识索引；必须安装 pgvector。未设置该模式时才使用本地 Desktop SQLite 后备。`credentials.enc.json` 只存储 AES-256-GCM Envelope。

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

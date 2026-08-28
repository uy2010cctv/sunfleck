---
description: "Enterprise local, OIDC, SAML, and LDAP login adapters。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-sso`

[English](README.md) | 中文

## 概述

Enterprise local, OIDC, SAML, and LDAP login adapters。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

企业登录适配器：

- Scrypt 本地引导认证。
- 带 PKCE、state 和 nonce 的 OIDC discovery 与 Authorization Code Flow。
- 使用 IdP 证书和 InResponseTo 校验的签名 SAML 2.0 Response。
- 通过 LDAPS 或 StartTLS 进行 LDAP 认证，并执行 RFC 4515 Filter 转义。
- 将 Claim/Group 归一映射到组织、用户和角色。

## Model Experience

### 认证适配器

#### What the model sees

无。`EnterpriseOidcProvider`、SAML、LDAP 和本地密码校验在浏览器或 Host 访问前运行，不增加模型可见界面。

#### Token effect

零 Token。认证在任何 Agent 请求存在之前完成。

#### KV Cache effect

无；认证不修改 Agent 发出的提供方请求。

## Known Limitations and Deferred Work

- 协议库测试不能替代与部署环境真实 IdP、Metadata、证书链和 LDAP 目录的验证。
- 集群 OIDC 事务需要共享的一次性 State Store。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

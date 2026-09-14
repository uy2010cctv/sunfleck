---
description: "Enterprise organization, role, visibility, deployment, and audit policy contracts。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-governance`

[English](README.md) | 中文

## 概述

Enterprise organization, role, visibility, deployment, and audit policy contracts。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

纯企业策略合同：

- 组织边界优先的授权。
- 管理员、创建者、运营者、审计员和成员角色。
- 组织、部门、员工和个人资源范围，以及范围内的私有和受限可见性。
- 人员部门归属、部门管理关系和最小权限的员工服务身份。
- 明确的用户、员工、记忆、能力、模型、凭据、审计、Session 和渠道动作。
- Desktop、LAN 和 Public 部署就绪证据。
- 不带任意 payload 字段的可归因治理审计记录。

本包只决定策略。身份 Provider、用户存储、SSO、加密凭据 Provider 和持久审计 sink 仍是部署适配器。

部门成员只能读取其角色与可见性允许的本部门资源。部门经理只能更新自己负责部门的数字员工、记忆和渠道。后台员工主体不具有人类角色，只能执行明确绑定到其不可变员工发布版本的渠道、员工或记忆资源。

## Model Experience

### Host 授权策略

#### What the model sees

无。`authorizeEnterprise` 在特权 Host 动作之前运行，不贡献 Prompt 分区、Message、Tool Schema、Tool Result 或模型调用。

#### Token effect

无。允许的动作继续进入其所属 DSH 能力，由该能力说明后续任何模型可见成本。

#### KV Cache effect

无。授权决策不组装或修改提供方请求。

## Known Limitations and Deferred Work

- 本包不附带 OIDC、SAML、LDAP 或登录 UI Provider。
- 本包不附带持久用户、组织、角色或审计仓库。
- 现有 owner-only 本地凭据文件本身不能证明已经加密静态存储。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

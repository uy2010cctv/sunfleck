---
description: "Persistent enterprise organizations, users, sessions, resource policies, and audit records。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-identity`

[English](README.md) | 中文

## 概述

Persistent enterprise organizations, users, sessions, resource policies, and audit records。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

为组织、树状部门、用户成员关系、角色、外部身份、哈希登录会话、受管 Workspace 授权、Session-Workspace 绑定、含成员、按员工绑定的群会话、话题与当值名册的 dm、群聊与频道协作面、已审核组织记忆、免审核直写的记忆分区（私有 agent、pair，以及按项目 ID 标注的成员制项目分区）、资源策略和可归因审计记录提供 SQLite 持久化。不直接存储 Bearer Token、密码或记忆来源的原始对话。

`EnterpriseIdentityStore` 是 Host 使用的持久化契约。SQLite `EnterpriseIdentityRepository` 只是其中一种实现；部署方可以注入事务型 PostgreSQL 实现，而不让认证逻辑依赖 SQLite 文件路径。

认证主体投影包含当前部门归属和主部门。授权服务从组织目录补充负责部门；调用方不能从显示名称或 Workspace 路径推断这些关系。

可选的 `collaborationSessionAccess` 查询返回已记录协作会话的配置工作区和调用者是否为明确成员，权限撤销后也返回否定的成员结果。不支持协作的提供方省略该方法；消费方仍须验证当前工作区访问权限，并在管理操作中保留会话所有权检查。

## Model Experience

### 身份持久化

#### What the model sees

无。`EnterpriseIdentityRepository` 是 Host-only 持久化，不贡献 Prompt、Message、Tool Schema、Result 或模型调用。

#### Token effect

零 Token。Repository 读写不进入模型历史。

#### KV Cache effect

无；身份持久化不组装提供方请求。

## Known Limitations and Deferred Work

- SQLite 是本地实现；企业 PostgreSQL 部署通过 `EnterpriseIdentityStore` 组合边界使用独立的 `@deepseek-ai/dsh-enterprise-identity-postgres` 适配器。 集群部署需要共享事务后端。
- 外部 IdP 和 LDAP 实时验证需要部署方提供的端点和证书。
- 记忆隐私筛查是按目标分区分类的确定性门禁：提示注入与超长摘要在任何分区阻断，个人偏好绝不进入共享分区。它不是完整 DLP 产品；共享前仍必须人工审核。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

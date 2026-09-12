---
description: "Versioned DSH enterprise employee drafts, releases, and capability assets。"
kind: "package-reference"
---
# @deepseek-ai/dsh-enterprise-catalog

[English](README.md) | 中文

## 概述

Versioned DSH enterprise employee drafts, releases, and capability assets。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

基于 DSH 原生身份的版本化企业目录：

- Agent Preset ID 仍是数字员工的权威身份。
- 草稿、发布、回滚和资产版本写入先获取实体锁，再获取幂等锁。幂等行把规范请求摘要与已存结果绑定；完全相同的重试返回该结果，同一 key 用于另一请求时明确失败。迁移期间仍可读取旧 schema 创建的仅结果行。
- 管理查询始终限定在单一组织内，使用参数化过滤，并按 `updatedAt` 和 ID 的稳定顺序通过 HMAC-SHA256 签名的不透明游标分页。
- 发布版本是带确定性 SHA-256 摘要的不可变快照。
- SOP、知识、技能、工具和模型资产均支持版本，并绑定到员工版本。
- 资产归档是带 revision 检查的逻辑写入；幂等键与请求摘要绑定，完全相同的重试返回原始结果。
- 拒绝明文密钥；运行时凭据只使用 `credentialRef` 引用。
- PostgreSQL 写入使用调用方事务，所有查询均参数化。
- 分页索引覆盖组织、更新时间和资源 ID。`pg_trgm` GIN 表达式索引覆盖小写 Preset ID、草稿 profile JSON、资产 ID 和资产名称，匹配本包的 `%term%` 搜索表达式。

生产仓库以 `Buffer` 或字符串提供稳定的 `cursorSigningKey`。生产组合要求至少 32 字节且包含至少 8 个不同字节值。未配置密钥的仓库仅能读取不需返回游标的首页；生成或消费游标会明确失败。游标 Payload 和签名 Segment 必须是规范 Base64URL，包括未使用的 Padding Bit。轮换密钥会使未完成的游标失效。

## 模型体验

### 目录持久化

#### What the model sees

无。目录只存储控制面元数据和发布快照，不增加 Prompt、Message、Tool 或模型调用。

#### Token effect

零 Token；只有发布后的员工进入既有 DSH Session 时才产生模型成本。

#### KV Cache effect

无；目录写入不组装提供方请求。

## 已知限制与暂缓事项

- 本包提供目录仓库和合同；Host API 组合与浏览器页面属于独立层。
- 设置 `DSH_TEST_POSTGRES_URL` 时运行 PostgreSQL 集成测试，CI 中必须设置。
- 数据库角色必须能在 Schema 迁移时安装 `pg_trgm`，否则部署方必须预先安装该 Extension。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

## 自主能力沉淀

`learnEmployeeAsset` 在同一事务中登记 SOP/Skill、绑定当前员工并发布版本，保留原有能力和未发布人工修改；重复调用幂等，同内容复用资产版本。

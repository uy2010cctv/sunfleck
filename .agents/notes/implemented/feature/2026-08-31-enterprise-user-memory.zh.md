# Agent Note：企业用户私有记忆

Status: implemented

[English](2026-08-31-enterprise-user-memory.md) | 中文

## 决策

DSH 企业记忆包含三层继承作用域：企业、部门和用户。Session 所有者绑定是当前用户的权威事实。用户记忆保存稳定工作偏好，只有 `ownerUserId` 与该 Session 所有者一致时才会返回；共享部门或 Workspace 永远不会授予他人用户记忆的访问权。

自动写入将 `createdBy` 归因于 Session 所有者，将 `reviewedBy` 归因于配置的自动化 Actor。用户范围可以保留会被共享范围拒绝的工作偏好；凭据、身份识别信息、联系方式、Prompt 注入、客户原文和超长摘要在所有范围内仍被拒绝。

Prompt 组装顺序为企业、部门、用户，且只注入已批准的带稳定 id 摘要。PostgreSQL 和 SQLite schema v6 新增 `owner_user_id`；历史企业和部门记忆以空所有者迁移，原语义不变。

作用域 ACL 过滤后，Prompt 上下文使用规范化拉丁词元与中文单字／双字重合选取有界的任务相关记忆包，并用作用域和新鲜度做确定性并列排序。没有用户任务文本时回退到最新已批准条目。该词法阶段完全本地运行，不会破坏后续 pgvector 接缝。

企业记忆治理页分开展示三层记忆。管理员查询只包含当前管理员本人的私有记忆正文，不返回其他用户的私有记。

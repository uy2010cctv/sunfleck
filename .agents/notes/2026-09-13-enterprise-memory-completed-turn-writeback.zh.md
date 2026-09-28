# 企业记忆已完成轮次回写

[English](2026-09-13-enterprise-memory-completed-turn-writeback.md) | 中文

旧的自 动记忆路径依赖主 Agent 调用 `remember_business_knowledge`。因此一次已完成的回答可能包含持久的业务知识，却没有产生任何记忆记录。

企业记忆上下文现在在 `agent/turn-stopping` 捕获直接的用户文本与最终助手回答，把有界快照持久化入队到 PostgreSQL，并在独立抽取开始前交还控制权。抽取器不带工具运行，只查看同组织、同部门的有界 active/pending 记忆，并输出严格的 `skip`、`create` 或 `conflict` 候选：完全重复跳过，高置信度创建直接激活，冲突或低置信度表述保持待审。

队列行按会话与轮次幂等。认领使用带过期的属主租约；完成与失败由租约属主 fencing。失败在 5、15、60、180 秒后重试，五次后停止自动重试，仍可手动重试。成功的工作会删除复制的会话快照，仅保留结果计数、记忆 id、时间戳与来源。每次写入都会复查当前工作区授权与 Session 属主。

企业治理页展示自动捕获活动、最新计数、失败任务与重试入口，不暴露快照。这沿用 `lemoncat7/dsh-knowledge` 中观察到的持久化 outbox 与独立抽取思路，同时保留 DSH Enterprise 的组织、部门、工作区、Session 属主、隐私、审计与异常审核边界。

验证包括 58 个聚焦测试、定向 TypeScript 构建、源码 lint，以及覆盖入队、抽取、激活、冲突、重复跳过、租约 fencing 形态与成功快照清理的独立真实 PostgreSQL 演练。

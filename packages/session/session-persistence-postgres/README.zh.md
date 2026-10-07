---
description: "PostgreSQL durable session persistence for DSH event logs。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-session-persistence-postgres`

[English](README.md) | 中文

## 概述

PostgreSQL durable session persistence for DSH event logs。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

这是一个可选的 PostgreSQL `SessionPersistence` 提供方，用于原生 DSH 事件日志。它保持现有 `SessionPersistence` 合同：会话头与首批事件在同一事务中惰性物化，事件仅可连续追加，并由协调器 在不改写已提交历史的前提下关闭中断回合。

## 存储模型

`dsh_session_headers` 保存不可变 JSON 会话头、持久化 incarnation 和单调 revision。`dsh_session_events` 为每个 `(session_id, seq)` 保存一个事件的完整 JSON 序列化文本，包括含 U+0000 的 JSON 字符串；PostgreSQL `JSONB` 无法表示这个合法 JSON 值。轻量 `stat` 与列表查询通过带索引的相关读取取得对话开始证据与最新 `session/title` 事件文本，再由应用解析该单个事件；它们不会读取消息正文。`stat` 还返回事件数量并验证持久化会话身份和格式版本；完整事件验证由 `open` 与 `read` 执行。PostgreSQL 会在读取尾部、插入批次或修复最后一条损坏记录前锁定会话头行，因此独立写入方不能同时占用同一下一序号。revision 由数据库本地 UUID、会话头 incarnation 和 revision 计数器共同限定来源。

该包公开驱动无关的 `PostgresDatabase` 接口。声明式 Cordis 组合使用 `connectionString`；集成测试 或嵌入式 Host 可以直接提供事务数据库对象。任何密钥或连接字符串都不会写入会话记录。

## 配置

```ts
interface Config {
  connectionString?: string
  database?: PostgresDatabase
  databaseMode?: 'postgres' | 'standalone'
}
```

请使用仅拥有该包 `dsh_session_*` 表权限的专用 PostgreSQL 角色。服务启动时会在事务中初始化 schema。`databaseMode: 'postgres'` 复用企业 PostgreSQL 连接池；`standalone` 使用 `connectionString`，可通过 PostgreSQL 连接选项选择独立 schema。提供方不会迁移已发布的 Session 事件格式：V4 写入器必须读取已在独立 schema 中准备好的 V4 行，历史表保持原样以供回滚。会话没有单独的原始文件，因此 `locate()` 返回 `undefined`，且不支持 `readRaw()`。

### 实时 Session 持久性

提供方把已发布的 `session/event` 值路由到活跃写句柄，在 `session/flush` 时排空，并在关闭或释放时排空剩余事件。失败批次会留在缓冲区等待下次 checkpoint 重试。关闭过程会尝试所有句柄并聚合失败。仅创建 Header 不能证明对话事件已经持久化。

## Model Experience

### 恢复的会话历史

#### What the model sees

模型不会看到 PostgreSQL 特有内容。恢复时重放与 JSONL、SQLite 提供方相同的逻辑 `SessionEvent[]`；会话头、revision、锁和行布局不会进入 Prompt 或 Tool 调用。

#### Token effect

零实时请求 Token。存储 I/O 仅发生在 Host。

#### KV Cache effect

无。缓存复用由重建后的逻辑历史和当前提供方请求决定。

## Known Limitations and Deferred Work

- 驱动形状测试覆盖顺序、冲突拒绝、回滚和尾部修复。真实 PostgreSQL 集成测试需要部署方提供测试服务，暂缓执行。
- 提供方不会把 PostgreSQL 的 V0/V3 行转换为 V4；运营者必须在选择 V4 schema 前验证转换和导入。
- 本提供方只负责事件持久化。全文和向量索引属于独立读模型，本包未实现。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

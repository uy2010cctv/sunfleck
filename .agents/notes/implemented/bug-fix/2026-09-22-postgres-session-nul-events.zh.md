# Agent Note: 在 PostgreSQL 中保留含 NUL 的 Session 事件

Status: implemented

[English](2026-09-22-postgres-session-nul-events.md) | 中文

## Problem

Session 事件格式允许所有 JSON 字符串值，包括 U+0000。PostgreSQL `JSONB` 会拒绝 JSON 转义 `\u0000`，因此一个合法事件可能异步追加失败并停留在 writer 重试缓冲区队首。后续所有事件都会被同一个不可写入的行阻塞，使界面可见的回合缺少持久化 `step/end` 与 `turn/end` 记录。

工作区指令协调器使用 NUL 连接指令目录与候选文件名，使这个问题可以稳定触发。读取嵌套 `CLAUDE.md` 会产生类似 `xhs-src\u0000CLAUDE.md` 的 source scope；随后的 `user/message` 是合法 Session JSON，但无法进入 PostgreSQL 事件表。

## Decision

`dsh_session_events.event_json` 使用 `TEXT` 保存序列化 JSON。schema 版本 3 通过 `event_json::text` 转换现有 `JSONB` 行；新增与修复事件不再使用 `JSONB` cast。读取方仍会把每个值解析并验证为 Session 事件，带索引的 `event_type` 列继续负责事件筛选。轻量标题查询只选择最新 `session/title` 事件文本，并由应用解析该单个事件。

工作区指令候选键使用由目录与候选文件名组成的 JSON 元组。解码器同时接受该表示与已发布的 NUL 分隔表示，因此含旧键的 JSONL Session 仍可读取。

## Alternatives considered

**在每次 PostgreSQL 写入前替换 NUL。** 该做法能保留现有列，但会静默修改任意用户、模型与工具文本，还会让往返相等性依赖存在歧义的转义约定。

**只修复工作区指令分隔符。** 该做法能阻止已观察到的生产者继续输出 NUL，但当其他合法来源包含 U+0000 时，PostgreSQL 提供方仍无法满足 Session 事件合同。

**增加第二个编码 JSON 列。** 双重表示可以保留查询运算符，但会为按完整事件对象读取的数据增加同步与迁移义务。独立索引的 `event_type` 与 `event_time` 列已经满足所需列表查询。

## Consequences

PostgreSQL 持久化现在接受与 JSONL 持久化相同的 JSON 字符串值，合法 U+0000 不会再堵塞 writer 队列。事件载荷查询必须在应用中解析文本，或只对包自有且已知安全的事件类型显式 cast。schema 启动时会在版本 2 数据升级过程中执行一次表列转换。聚焦测试覆盖迁移查询、U+0000 往返、JSON 安全指令键，以及已发布 NUL 分隔键的解码。

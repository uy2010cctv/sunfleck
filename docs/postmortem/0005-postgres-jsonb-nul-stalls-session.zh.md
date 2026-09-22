# 事故复盘（postmortem）0005：PostgreSQL JSONB 拒绝合法事件并堵塞 Session

[English](0005-postgres-jsonb-nul-stalls-session.md) | 中文

状态：已解决

## 执行摘要

一个生产 Agent Session 在外部发布失败后读取嵌套 `CLAUDE.md`，随后停止推进。发布失败本身已被隔离，但工作区指令元数据在候选键中使用 NUL；PostgreSQL `JSONB` 拒绝合法 Session JSON 转义 `\u0000`。失败事件停在异步 writer 队首，并阻塞后续所有回合边界。候选键现在使用 JSON 安全元组，PostgreSQL 使用无损文本保存事件 JSON，测试同时覆盖生产者与持久化合同。

## 摘要

外部发布在图片上传超时后返回普通工具错误。Agent 继续进行只读诊断，并成功持久化工具调用、工具结果与 `step/end`。读取源码文件使工作区指令协调器在下一步骤发现仓库内嵌套的 `CLAUDE.md`。

协调器使用 `<目录> NUL <候选文件>` 标识每个目录与候选文件。该内部键以 `xhs-src\u0000CLAUDE.md` 的形式进入下一个持久 `user/message` source。JavaScript `JSON.stringify` 生成了合法 JSON，但 PostgreSQL `JSONB` 无法把 `\u0000` 转换为其文本表示。

## 影响

首个被拒绝的事件保留在在线 PostgreSQL writer 缓冲区。后续每次 flush 都重试同一批次，因此 `step/end` 与 `turn/end` 也只能停留在进程内存。Web 客户端收到瞬态失败帧并显示重复的终止错误，而持久 Session 停在最后一个成功事件。页面刷新或进程退出可能丢失可见失败，只能由恢复逻辑推断中断回合。

外部发布没有产生半成品帖子。可用性故障发生在后续源码读取流程中的 DSH Session 持久化阶段。

## 时间线

- 图片上传超时并返回结构化失败工具结果。
- Agent 继续诊断并读取嵌套项目源码文件。
- 工作区指令发现准备了 source 含 NUL 分隔候选键的 `user/message`。
- PostgreSQL 以 `unsupported Unicode escape sequence` 拒绝写入，详情为 `\u0000 cannot be converted to text`。
- 后台 drain 重试同一个不可写事件，使后续边界事件无法推进持久序号。
- 数据库日志与停止的事件序号定位到持久化表示不匹配；聚焦测试在修复前复现了生产者键与提供方失败。

## 根因

工作区指令包依赖文件系统路径不能包含 NUL 的规则，并在持久 JSON 元数据中复用了该分隔符。该分隔符适用于内存 Map 与 JSONL 文本，但不适用于 PostgreSQL `JSONB`。

PostgreSQL 提供方把事件载荷声明为 `JSONB`，但共享 Session 格式允许所有 JSON 字符串。异步 writer 正确保留失败批次，但确定性的表示不匹配使这个持久性行为变成无限队列阻塞。测试使用可接受 U+0000 的内存 JSON 解析器，没有模拟 PostgreSQL 更窄的 `JSONB` 值集合。

## 已添加的防护措施

- 工作区指令候选键使用 JSON 元组，并同时解码新表示与已发布的 NUL 分隔键。
- PostgreSQL schema 版本 3 使用 `TEXT` 保存序列化事件 JSON；读取方仍会解析并验证每个完整事件。
- 标题列表只选择最新 `session/title` 文本，并由应用解析该事件；事件类型与时间继续使用独立索引列。
- PostgreSQL 测试适配器复现 `JSONB` 对 `\u0000` 的拒绝，端到端 store 测试要求 NUL 精确往返。
- Agent 指令测试拒绝新 scope 键中的 NUL，并固定已发布键表示的解码行为。

## 验证

生产 Host 已迁移到 schema 版本 3，`dsh_session_events.event_json` 读回为 `text`。中断 Session 先持久补写合成 `turn/end`，随后完成一个新的两步骤回合：读取同一个嵌套 `CLAUDE.md`，使用 scope `["xhs-src","CLAUDE.md"]` 持久化指令上下文，并返回“会话恢复正常”。浏览器完整刷新后仍保留已修复历史与完成回合。部署后 PostgreSQL 没有新增 `unsupported Unicode escape sequence`，外部发布服务保持 active，且没有再次调用发布。

Host 在部署启动时两次遇到既有的客户端模块 `webServer` 注入顺序竞争；systemd 第三次启动完成并持续 active。该启动缺陷与事件序列化无关，仍可通过 `NRestarts=2` 单独观察。

## 教训

- 内部标识一旦进入持久事件，就成为存储格式。
- 持久化提供方必须表示完整共享事件格式，而不能只支持其原生结构化类型的便利子集。
- 只有当所有合同有效事件都可表示时，保留失败追加才是安全的；否则持久性会把一次确定性拒绝放大为整条队列的可用性故障。
- 即使用户在同一流程中观察到外部工具失败与 Session 失败，也必须用独立因果证据区分两者。

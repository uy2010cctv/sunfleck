# 2026-09-21 录音增量三层记忆加工记录

时间：2026-09-21。

[English](2026-09-21-incremental-memory-processing.md) | 中文

## 流程

47 的持久 worker 在原文入库读回成功后，按用户汇总尚未加工的新段，附带最近两分钟上下文调用 DSH `/recorder-memory/process`。处理成功后才将 `org_id + user_id + segment_id` 写入 `processed_v1`；网络、模型或入库失败均不确认，下轮重试。

## 模型与规则

- 复用 DSH 已配置路由 `zai-coding-cn / glm-5.3-flash`，专用加工调用使用 low reasoning、1024 输出 token 与 15 秒总超时。
- 录音文本被标记为不可信证据，不能作为执行指令。
- 输出只允许 `episode` / `semantic` / `behavioral`，每条必须引用真实 `evidenceSegmentIds`。
- 行为层至少需要一条 `speaker=self` 证据；否则服务端丢弃该输出。
- 证据不足时持久化 `layer: processing-status` / `status: no-new-memory`，并记录本轮新段 ID。
- 每轮输出绑定 `input_version` 摘要；相同输入重试返回已有文档。

## 验证

- 解析器、证据约束、行为层本人限制、HTTP 鉴权、用户范围、知识工具与时间范围主题排序共 29 项针对性测试通过，TypeScript 检查和正式构建通过。
- worker 4 项测试通过，覆盖两分钟上下文、新段标记、复合幂等键与无归属数据隔离。
- 隔离测试用户的真实 GLM 调用在 8.34 秒内返回 HTTP 200，生成 behavioral 记忆，包含原文段 ID 和 0.9 置信度。
- 真实用户的模糊短段“没钱上。”返回加工完成且无新增记忆，没有生成事实或待办。

## 运行边界

历史已确认的原文段已预置加工游标，本次发布不会对旧库突然发起大量模型调用。从发布后的新非空语音段开始自动加工。

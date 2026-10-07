---
kind: upgrade-guide
description: "面向人类的房间事件读取立即返回已提交记录，原生日志修复在后台异步执行。"
---
# 房间事件修复改为异步执行

[English](guide.md) | 中文

## 变更

`GET /enterprise/surfaces/:id/events` 会在原生日志异步修复期间返回已提交的签名房间事件。此前依赖请求等待恢复结束的读取方，需要继续轮询以接收新恢复的回复、工具记录与 Team 记录。响应新增 `reconciling`，表示响应时原生日志恢复回放正在执行。现有事件身份、顺序、游标与授权检查保持原有语义。

## 迁移

1. 在 `/enterprise/surfaces/:id/events` 的客户端中立即显示返回的 `items`，并用 `reconciling` 展示修复进行中的提示。
2. 房间打开期间保持游标轮询，使用 `after` 和最后接受的 `nextCursor`，按现有事件身份合并记录。修复标志表示响应时是否正在回放原生日志，因此它变为 false 后仍需继续轮询。
3. 确认延迟恢复的房间在打开后立即显示已提交消息，并在后续轮询中添加新恢复的记录且不重复。参见[房间 API 说明](../../../../packages/api/enterprise-controller/README.zh.md)。

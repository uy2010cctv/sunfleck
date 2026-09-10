# Agent Note：企业 Session 用户归属隔离

Status: implemented

[English](2026-08-31-enterprise-session-owner-isolation.md) | 中文

## 问题

企业 Workspace 可见性曾被错误等同于 Session 可见性。部门成员可以共享部门 Workspace 是正确的，但原生 Workspace 投影会返回该 Workspace 下记录的所有 `sessionId`，导致普通侧边栏中一位成员能发现另一位成员的对话。

## 决策

共享 Workspace 不等于共享对话。每条企业 Session 绑定在组织和 Workspace id 之外，还持久化已认证的创建用户 id。Workspace follow 投影在活动和归档 Session id 到达浏览器前，先按当前 principal 过滤。Session 列表、实时控制流和转发的 Session 新增／移除事件也使用同一所有者边界，因此被隐藏的行不会又出现在「未分组」或通过实时更新回流。直接 Session 授权使用同一创建者并将会话视为私有资源；管理员调查应走治理与审计路径，而不是普通侧边栏发现。

Schema v4 升级到 v5 时，个人 Workspace 中的历史绑定可以从 Workspace 所有者安全回填。历史部门绑定没有可信的创建者事实，因此迁移保留其未归属状态并默认隐藏，不猜测创建者而造成泄露。新部门 Session 在 `session.create` 提交时必须写入所有者。

## Alternatives considered

**只过滤 Sidebar。** 拒绝，因为直接 Session API 和实时事件仍可能暴露其他成员的对话。

**推断旧部门会话 owner。** 拒绝，因为未经验证的 owner 归属会造成隐私泄露；旧记录保持隐藏，直到出现可信 owner。

## 影响

- 用户在个人和部门 Workspace 中只看到自己的 Session。
- 部门文件和已批准的部门记忆仍然共享。
- 其他成员的对话和归档 Session id 不会进入侧边栏数据流。
- Session 归属由 Host 投影和资源解析器强制，不是前端隐藏。

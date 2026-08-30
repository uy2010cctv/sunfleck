# Agent Note: 企业 Workspace 可见性与删除

Status: implemented

[English](2026-08-30-enterprise-workspace-visibility.md) | 中文

## 问题

企业 HTTP Workspace 列表已按当前用户裁剪，但对话侧边栏使用原生 `workspace.follow` 流。
该流暴露进程内完整的 Workspace Registry，包括其他用户的个人 Workspace。原生删除
Remote 也会在没有企业所有权策略的情况下到达 Registry，因此只隐藏 UI 无法保护默认、
部门或其他用户的 Workspace。

## 决策

DSH 原生 Workspace Registry 仍是权威数据源，经过认证的 Gateway 按当前账号投影
`workspace.follow`。投影仅包含当前用户拥有的个人 Workspace，以及当前用户所属部门的
Workspace。基线、实时新增、移除、排序帧和已归档 Session id 都使用同一授权边界。

用户拥有的最早个人 Workspace 是系统默认工作区，不可删除。部门 Workspace 和其他用户的
个人 Workspace 也不可删除。只有当前用户后续创建的个人 Workspace 可删除。Gateway 在调用
原生删除命令前强制执行规则；Client 在 Workspace 投影携带 `deletable: false` 时移除删除入口。

企业成员仍可使用原生 Workspace 创建能力。Registry 创建 Workspace 后，经过认证的 Gateway
会在返回结果前记录其个人所有权授权。没有企业授权的 Registry 行不会投影给企业客户端。

## 考虑过的替代方案

**只在 React 中过滤。** 拒绝，因为直接 Remote 调用和其他客户端实现仍可以枚举或删除受保护的
Workspace。

**在对话侧边栏向管理员显示全部 Workspace。** 拒绝，因为治理检查与普通 Agent 工作用途不同。
管理员仍可通过企业治理界面查看全组织数据，对话侧边栏则遵守与其他用户相同的个人/部门隐私边界。

**新建第二套企业 Workspace Registry。** 拒绝，因为 Workspace、Session 归属和流排序已属于原生 Registry。
企业层对该数据源进行投影和授权，而不是分叉它。

## 影响

- Host 强制执行而非菜单可见性，是真正的授权边界。
- 受保护 Workspace 在策略允许时仍可重命名；只移除其破坏性菜单操作。
- 删除允许删除的 Workspace 注册仍保留目录和 Session 历史，继续遵守 DSH 原生删除合同。
- 现有未授权的 Registry 行会从企业侧边栏消失，不再被视为组织全局 Workspace。

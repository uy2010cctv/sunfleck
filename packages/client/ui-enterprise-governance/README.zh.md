# `@deepseek-ai/dsh-client-ui-enterprise-governance`

[English](README.md) | 中文

企业登录和管理界面：

- 使用本地与已配置 SSO Provider 的全帧认证 Gate。
- 组织和树状部门编辑、用户部门归属与主部门、角色变更、启用/停用控制。
- 个人/部门 Workspace 清单及受治理的沙盒模式。
- 经过隐私筛查的记忆提案、审核队列和已批准的企业感知流。
- 为员工、模型、能力和渠道管理可见策略。
- 支持执行者和动作过滤的持久审计账本。
- 仅管理员可见的“设置”分区，不再重复占用 Sidebar 入口；Host RBAC 仍是权威来源。

## Model Experience

### 治理浏览器界面

#### What the model sees

无。该 UI 调用 `/auth` 管理端点，不贡献 Prompt、Message、Tool Schema、Result 或模型调用。

#### Token effect

零 Token。治理界面不进入 Session 历史。

#### KV Cache effect

无；打开或编辑治理状态不组装提供方请求。

## Known Limitations and Deferred Work

- 首个 UI 使用中文运营文案；可通过 Locale Dictionary 扩展，无需修改 Host 策略。
- 只有已配置的 Provider 才显示外部 SSO 按钮。

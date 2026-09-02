# Agent Note: 基于 Agent Teams Session 日志的企业 TeamRun

状态：已实现

[English](2026-09-02-enterprise-team-runtime-adapter.md) | 中文

## 问题

企业控制面可以预留 TeamRun 并投影运行结果，私有 Agent Teams 领域已经拥有持久 roster、mailbox、任务 DAG 与可继续 child。产品桥接不能建立第二个运行数据库、用可变 preset 代替不可变员工 Release、把 Human 请求 principal 继承给自主 turn，也不能报告从未安装的能力绑定。

## 决策

`@deepseek-ai/dsh-experimental-enterprise-team-runtime` 实现注入式 `EnterpriseTeamRuntimeDriver`。既有 `TeamService` 继续作为运行 Team 事件的唯一 owner。其根 Session 日志在现有 Agent roster、mailbox 与任务事件旁增加版本化 TeamRun、Human member 与 decision 快照。

根 Session id 是 TeamRun id 的确定性函数。重复启动操作会在创建工作前检查并折叠该 Session，使控制面 operation id 与运行日志收敛到同一身份。driver 会在 runtime 边界再次解析认证组织、Workspace grant、员工 Release 与 Human 目录条目。

Team Lead 使用领队 Release 的 preset、已配置模型路由与 persona。可继续 teammate 在持久 descriptor 与 Team member 事件中保留精确 Release id、digest、preset、模型路由、角色、persona 与工具过滤器。Human roster 条目只携带用户身份和角色；没有 Session id、mailbox 权限、工具或凭证继承。

在具备版本感知 runtime assembler 前，adapter 不接受任何能力资产绑定。SOP、知识、技能、工具与模型资产绑定会被拒绝，而不是被静默忽略。支持来自 Release profile 的模型路由。

启动先记录 `starting`，登记 roster，创建 Agent child，记录 `active`，再在企业 principal 上下文之外提交初始目标。部分 provisioning 会记录 `failed`、drain 已创建 child，并 dispose 新根 handle。取消先记录 `cancelled`，再中断 live Agent。Human 回答是带 CAS 的 Team decision 事件，随后在不传播 Human principal 的情况下送达 Lead。

## 恢复与所有权

Session 日志而非进程内 handle 拥有持久状态。对账无需恢复 Agent，只折叠已存事件。命令需要 live root 时，adapter 用固定 Release 恢复 root，subagent continuation manager 从 descriptor 冷恢复 child。adapter dispose 只释放 live handle，不删除 Session 数据。

企业 overlay 依次加载 Agent Teams Host、工具、浏览器投影、本 adapter 与企业 controller。普通 Web profile 不变。所有这些包仍为私有，不进入正式发布。

## 考虑过的替代方案

**只在 PostgreSQL 中存储运行 roster 与决策。** 拒绝，因为这会建立第二个运行权威并失去原生 Session 回放。

**使用最新可变 Agent Preset。** 拒绝，因为 TeamRun 必须保留精确员工 Release 身份与模型/persona 证据。

**忽略不支持的资产绑定。** 拒绝，因为 UI 证据会宣称 runtime 未安装的能力。

**把认证 principal 传入 Agent turn。** 拒绝，因为自主 Agent 不得继承 Human 权限或凭证。

## 验证

测试覆盖旧 Team 事件回放、Human/Agent 混合 roster 投影、operation-id 重放、runtime revision 与 decision CAS、不可变 Release metadata、Workspace 与 Session 绑定、部分启动清理、取消、Human 回答唤醒、冷对账、重启恢复、缺失或跨组织 Release、不支持绑定、controller 注入和企业 overlay 顺序。

## 后果

本地企业 profile 可以用不可变员工证据启动并对账真实 DSH TeamRun。Human task ownership、版本感知资产装配、多进程 Team 所有权、外部渠道与完整 Team Room 仍是独立工作。

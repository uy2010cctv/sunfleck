# Agent Note：持久化企业工作启动

状态：已实现

[English](2026-09-07-durable-enterprise-work-start.md) | 中文

## 问题

目标优先的企业工作启动必须在 Host 重启和并发重试后仍收敛到同一个 Session。进程内完成缓存会让成功重试依赖单个服务实例；可读或调用方提供的 Session ID 则可能泄露请求内容，或让不同意图悄然共享结果。

## 决策

`enterpriseWork.prepare` 和 `enterpriseWork.start` 的请求与结果词汇位于 `contract/work.ts`，并从包根和 `./types` 重新导出。`prepare` 对单个 preset 自动选择版本最高的 release，而显式指定的可见历史 release 仍然有效。`start` 解析已授权工作区和已发布员工 release 后，只从组织、用户和幂等键派生 `session-work-<sha256>`。

该确定性且不透明的 ID 作为 `sessionId` 传入 `SessionController.create`，由既有原生 create-or-adopt 行为完成 Session 收敛。企业 Session-工作区绑定已对同一元组幂等。operations 工作记录仍是持久幂等边界，并在 source references 中保存选定 release id、preset id、请求指纹、目标摘要和可选截止日期。变更后的请求或 release 保持同一 Session ID，但会改变持久记录输入，使既有 operations 幂等冲突拒绝复用，而不会返回过期启动结果。

## 验证

聚焦的 work-start 测试证明独立服务实例会为同一请求派生并提交相同的不透明 ID，在同一键下变更输入会由持久记录指纹拒绝且不会分配另一个 Session，并验证 Remote controller 将选定 release preset 和确定性 ID 传递到原生 Session 创建、企业绑定和工作记录持久化。

## 考虑过的替代方案

- **进程内 completed map**——不予采用，因为它会在重启后丢失，也无法协调独立服务实例。
- **随机 Session ID 加新的 work-start 表**——不予采用，因为原生 Session 收养和既有 operations 幂等记录已提供需要的持久接缝。
- **只对幂等键计算指纹**——不予采用，因为变更目标、工作区或 release 的输入可能悄然复用先前结果。
- **把原始请求值放进 Session ID**——不予采用，因为 Session ID 会出现在常规运维路径中，不能披露工作意图。

## 后果

不确定结果后的重试可安全地重新进入三个幂等接缝，原生 Session ID 是共同连接键。release 与请求指纹有意作为不可变 source references，因此在复用幂等键时变更输入会明确失败，而不是替换原工作。此切片仍仅为后端：不增加工作启动 UI、模型路由、团队、附件、预算或自主权授权。

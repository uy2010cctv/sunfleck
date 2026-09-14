# Agent Note：数字员工发布的幂等同步

状态：已实现

[English](2026-09-14-idempotent-employee-publish-reconciliation.md) | 中文

## 问题

数字员工发布会先提交不可变目录版本，再更新可写的原生 Agent Preset。如果 Preset 写入失败，API 会报告失败，但发布版本已经存在。用户使用新幂等键重复点击后，会从未变化的已发布草稿生成重复版本。

员工 Controller 类声明了 `agentPresets`，但外层插件的根 inject 列表漏掉了它。真实运行时访问因此被 Cordis 拒绝，而隔离 Controller 测试通过手工提供依赖绕过了该检查。

## 决策

状态已经是 `published` 的草稿若内容未变且摘要与最新版本一致，再次发布直接返回最新版本。Repository 会记录新的幂等键，不增加版本号，也不再次修改草稿修订。

Controller 对幂等的原生 Preset 写入重试一次。若仍失败，API 会明确报告版本已经发布。再次点击发布时，目录返回当前版本，只继续完成剩余的 Preset 同步。

根插件现在显式声明 `agentPresets`，与员工 Controller 的实际运行依赖一致。

## 结果

目录提交成功后，重复点击不会再制造多个发布版本。修改后的草稿仍会产生新的不可变版本。目录保持权威状态，原生 Preset 是新 Session 使用的可重试投影。

## 验证

Repository 测试使用两个幂等键重复发布同一已发布草稿，并断言只存在一个版本且草稿修订只变化一次。Controller 测试检查根 inject 声明、注入一次瞬时 Preset 写入失败，并断言目录只发布一次、投影尝试两次。

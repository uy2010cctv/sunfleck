# Agent Note: 数字员工发布的幂等同步

Status: implemented

[English](2026-09-14-idempotent-employee-publish-reconciliation.md) | 中文

## 问题

数字员工发布会先提交不可变目录版本，再更新可写的原生 Agent Preset。如果 Preset 写入失败，API 会报告失败，但发布版本已经存在。用户使用新幂等键重复点击后，会从未变化的已发布草稿生成重复版本。

员工 Controller 类声明了 `agentPresets`，但外层插件的根 inject 列表漏掉了它。真实运行时访问因此被 Cordis 拒绝，而隔离 Controller 测试通过手工提供依赖绕过了该检查。

该投影还把编译后的员工身份写进 persona 行不支持的 `config.text` 字段。persona 插件实际读取 `config.prefix`，因此员工名单和会话标题能显示所选员工，模型请求却仍保留复制来源 preset 的通用身份。

## 决策

状态已经是 `published` 的草稿若内容未变且摘要与最新版本一致，再次发布直接返回最新版本。Repository 会记录新的幂等键，不增加版本号，也不再次修改草稿修订。

Controller 对幂等的原生 Preset 写入重试一次。若仍失败，API 会明确报告版本已经发布。再次点击发布时，目录返回当前版本，只继续完成剩余的 Preset 同步。

根插件现在显式声明 `agentPresets`，与员工 Controller 的实际运行依赖一致。

Preset 同步会用编译后的员工名称、岗位、部门、职责提示词和身份一致性规则替换 persona `prefix`。它也会移除同一行的遗留 `text` 字段，因此重新发布可以修复早期实现写入的 preset。

## 备选方案

**在每次请求中把员工字段注入 preset persona 之外。** 这会建立第二个身份来源，并使已发布 preset 与会话实际可重建的系统提示词不一致，因此拒绝。

**让 persona 插件把 `text` 接受为别名。** 这会把意外字段保留在文档化配置之外，也会削弱其他字段拼写错误的失败可见性，因此拒绝。

## 结果

目录提交成功后，重复点击不会再制造多个发布版本。修改后的草稿仍会产生新的不可变版本。目录保持权威状态，原生 Preset 是新 Session 使用的可重试投影。重新发布现有员工会修复其 persona；运行中的 Session 保持启动时的 preset 代际，新 Session 会获得修复后的身份。

## 验证

Repository 测试使用两个幂等键重复发布同一已发布草稿，并断言只存在一个版本且草稿修订只变化一次。Controller 测试检查根 inject 声明、注入一次瞬时 Preset 写入失败，并断言目录只发布一次、投影尝试两次。

创作回归测试从有效的通用 persona 前缀开始，验证员工同步会移除通用身份和不受支持的 `text` 字段，同时保留编译后的员工身份。

---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-06-sunfleck-enterprise-attribution

[English](2026-10-06-sunfleck-enterprise-attribution.md) | 中文

## 概述

SUNFLECK 企业扩展在 v0.2.1-alpha.1 源码目录中保留现有 V4 事件及消息归属元数据。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-06-sunfleck-enterprise-attribution
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "0e4c8531824dd258497f00bfe9c58cd36615eda1af3d8bee31781908e6bd9976"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "e00a17c8c9f292e386a0d632445fc80684956b96c6566de786959dddace464f7"
    decision: same-version
  - root: "event:enterprise-employee/cleared"
    previous: null
    after: "d33ca6545c96f315b2d974b406da301ba6a95f48f72f5c96ae866dbed0c53ff0"
    decision: same-version
  - root: "event:enterprise-employee/selected"
    previous: null
    after: "4fe6b7e13d860d7a6f53e3ea9c94423de599918db85b82e1ab66cfb7270a709c"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "39d3daf900d452dea33ce71719d31cba2f7d1f61395f15f8a4641705e4ffaf44"
    decision: same-version
  - root: "event:team/decision"
    previous: null
    after: "7252bdbf90e36cb0f03f4d42667d89b1df5547af7039e0b5de0718f03a9e7713"
    decision: same-version
  - root: "event:team/human-member"
    previous: null
    after: "c86d428141ee623497bdc58ee5eadfb9cd4b6d82aba214b501d407852b169762"
    decision: same-version
  - root: "event:team/member"
    previous: "2026-09-11-initial"
    after: "336418fa3f10c534c1aebbb5cc5dbbc03124c4c85096e6270150bf5eda97d12e"
    decision: same-version
  - root: "event:team/run"
    previous: null
    after: "9da8235ff24f685b83d81ef83bb19b64c5ab4b963f290d05834fd37c2dcd2975"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "94af482a2d5d9f2c47661a5d31197dba557dfcbc0fa2f28a725d19fdbaa383b0"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

六个企业生产者标签只归属已记录的普通消息块；共享读取器保留未知归属标签及字段。可选的人类消息来源路由字段不替代消息正文。员工选择、设备附件和群消息投递事件仍由现有插件提供。兼容性分类器相对已接受的 V4 基线未发现要求版本递增的变化。不改写任何已提交的 Session 世代或已定稿确认记录。

<a id="verification"></a>
## 验证

Host 和 Client TypeScript 编译已通过。企业、工作模式和定时任务行为测试在修正夹具后通过；group-schedule-cooperation 录制场景已通过内置 headless profile 回放。新增后继记录前已从合并源码提取目录，并与已接受的 V4 基线检查兼容性。

<a id="dev-note"></a>
## 开发备注

无。

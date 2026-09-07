---
description: "Enterprise digital-employee roster and operations workbench over DSH runtime facts。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-client-ui-enterprise-workbench`

[English](README.md) | 中文

## 概述

Enterprise digital-employee roster and operations workbench over DSH runtime facts。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

DSH Web 的企业数字员工运营界面。企业 Profile 通过强类型 Host API 读取经过身份校验的 PostgreSQL catalog 与 operations 投影；普通 Profile 只在企业域明确返回 unavailable 时保留原生运行时投影：

- Agent Preset 是数字员工。
- Workspace 是业务空间。
- Session 是工作记录。
- 待处理交互、运行状态、完成提示、Jobs 和 Session 投影继续由原有包负责。

浏览器插件向 `sidebar.footer.action` 增加入口，向 `shell.overlay` 增加运营台；不会替换 Sidebar 或 Conversation。企业治理继续属于 Settings。Overlay 内部管理数字员工、工作记录、审批、定时任务、能力资产和团队；桌面使用导航侧栏，窄屏使用容器内横向导航，页面本身不产生横向滚动。

Controller 调用 `enterpriseEmployees`、`enterpriseAssets`、`enterpriseTeams` 和 `enterpriseOperations`，不接受也不发送组织或 principal，身份由 Host 注入。员工搜索、发布状态、可见性和负责人筛选均在服务端执行，并使用 cursor 分页。员工编辑为显式保存草稿，由 `expectedRevision` 保护；冲突时保留未保存输入。发布、版本历史、回滚、工作状态、审批决策、调度生命周期、资产版本和固定团队都使用真实强类型 mutation。

员工页顶部提供目标优先的工作面板。它把目标、可选截止时间，以及仅在确有打开的原生 Session 时才存在的该 Session 发送给 `enterpriseWork.prepare`；不会按列表顺序猜测工作区。就绪结果以一次浏览器生成的幂等键启动工作，打开返回的原生 Session 并关闭 Overlay。存在歧义时只从已加载的浏览器快照中展示匹配的 Workspace 名称，或数字员工姓名与发布版本；标识符、模型路由与团队设置不会出现。准备或启动失败保持可见，并提供重试和清除操作。

企业 Host frame 由 runtime 的唯一流消费者转发。每个企业 frame 都携带 `resourceType`；工作台按 `eventId` 去重，即使归属页在后台也会刷新对应 read model。所有 mutation 共用可控的错误/重试状态，重试复用首次生成的 idempotency key。Revision conflict 绝不使用旧 revision 重试：恢复操作只重新加载服务器版本，员工编辑保留本地未保存副本并显示差异。运营人员随后明确采用服务器草稿，或在新服务器 revision 上保留本地字段。如果重载失败，重试只重复该重载。各页失败保持独立：loading、empty、error、forbidden 和部分成功不会清除已成功读取的模型。

`preset.yml` 可选声明展示字段：

```yaml
employee:
  position: 通用执行员工
  department: 数字化运营
  capabilities:
    - 文件与命令执行
    - 信息检索
```

这些字段只用于展示。Preset id 仍是唯一运行时与员工身份，能力标签不会授予工具或权限。

## 普通 Profile fallback

只有 `enterpriseEmployee.list` 返回明确的 enterprise-unavailable 应答时才进入 fallback。其他传输、授权、cursor 或服务端错误保持可见，不会静默降级到更宽的原生投影。fallback 中选择工作记录会打开来源 Session，启动员工会携带对应 Agent Preset 创建原生 Session。

## 安全边界

本界面不负责用户认证或工作记录授权；它消费 Host 已按身份与权限过滤的 read model，mutation payload 中不发送 `orgId` 或 `principal`。单企业内网多用户部署仍必须组合企业 Host 身份与授权服务。loopback/trusted-host 只是传输边界，不是身份认证。

## Model Experience

### 浏览器运营投影

#### What the model sees

无。该工作台只投影浏览器状态并调用 `SessionRuntime.create`；不增加 Prompt 分区、模型 Tool、Message、Session Event 或模型调用。

#### Token effect

无。启动员工会创建原生 Session，之后的 Conversation 请求自行承担常规 Token 成本。

#### KV Cache effect

无。打开工作台不组装或修改提供方请求。

## Known Limitations and Deferred Work

- 企业 UI 只展示 catalog 和 operations read model 中存在的字段，不推断生产力、SLA、完成百分比或业务结果。
- 草稿 profile 是开放 JSON 上的强类型 UI 投影；本编辑器只写回它支持的 profile 字段。
- 能力绑定和团队成员使用已加载的资产与发布版本选择器；原始 ID/JSON 只在高级编辑中保留，用于尚未结构化的策略细节。
- 身份认证、角色分配、凭据、模型管理和组织治理仍属于 Settings。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

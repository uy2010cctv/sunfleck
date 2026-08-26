# `@deepseek-ai/dsh-client-ui-enterprise-workbench`

[English](README.md) | 中文

DSH Web 的企业数字员工运营界面。它只投影现有运行时，不创建第二套业务数据面：

- Agent Preset 是数字员工。
- Workspace 是业务空间。
- Session 是工作记录。
- 待处理交互、运行状态、完成提示、Jobs 和 Session 投影继续由原有包负责。

浏览器插件向 `sidebar.footer.action` 增加入口，向 `shell.overlay` 增加运营台；不会替换 Sidebar 或 Conversation。选择工作记录会回到来源 Session；选择员工会通过现有 Session 创建接口携带对应 Agent Preset，再打开原生会话。

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

## 安全边界

本界面不负责用户认证或工作记录授权。单企业内网多用户部署仍必须接入经过认证的 Host 身份和授权策略，才能声称具备多用户隔离；loopback/trusted-host 只是传输边界，不是身份认证。

## Model Experience

### 浏览器运营投影

#### What the model sees

无。该工作台只投影浏览器状态并调用 `SessionRuntime.create`；不增加 Prompt 分区、模型 Tool、Message、Session Event 或模型调用。

#### Token effect

无。启动员工会创建原生 Session，之后的 Conversation 请求自行承担常规 Token 成本。

#### KV Cache effect

无。打开工作台不组装或修改提供方请求。

## Known Limitations and Deferred Work

- 员工状态来自浏览器当前 Session 镜像，不是 HR 考勤或在线状态。
- 工作记录数字是 Session 数量，不代表业务结果或生产力。
- 首版没有企业用户/角色 Provider、跨用户可见性过滤、聚合审批箱或持久团队定义。

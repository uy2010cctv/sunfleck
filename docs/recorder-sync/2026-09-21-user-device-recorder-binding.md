# “我的设备”与录音卡用户绑定记录

时间：2026-09-21。

工作台导航和页面标题已由“我的电脑”改为“我的设备”。电脑仍通过“连接此电脑”与本机 Device Agent 配对；录音卡使用独立的一次性绑定码流程，不获得 Computer Use 权限。

完整设计、迁移规则、安全边界和验收条件由 [用户级录音卡设备绑定 Agent Note](../../.agents/notes/implemented/architecture/2026-09-21-user-scoped-recorder-device-binding.zh.md) 维护。

本轮还根据远程诊断，把真实录音卡 SN `SD1A1D3000E6D` 增加到 `default-enterprise/bootstrap-admin` 的网关白名单，保留原 `CB08` 别名。修改前备份为 `/home/recorder/users.json.before-device-sn-20260921-1045`，注册表权限保持 `0600`。

## 工作台文案

- 中文导航与页面标题使用“我的设备”，英文对应 `My devices`。
- 页面说明区分电脑和录音卡：电脑可执行已授权的浏览器或桌面操作；录音卡提供用户私有录音与记忆流。
- 电脑动作继续使用“连接此电脑”，避免把录音卡误解为 Computer Use 执行设备。
- 工作台组件测试 79 项通过；Impeccable detector 未发现问题。

## 47 候选 release

已从当前线上 `/opt/dsh/releases/knowledge-http-auth-e0fa3f599c` 创建未激活候选 `/opt/dsh/releases/my-devices-20260921`。候选只替换工作台设备文案的源文件与已构建客户端文件；`node --check` 通过。`/opt/dsh/current` 尚未切换，线上页面仍保持原文案。

## 上线尝试与回滚

用户授权上线后，`/opt/dsh/current` 曾原子切换到候选 release。候选由硬链接复制生成，包含共享的 `.git` hooks 状态；DSH 启动触发 pnpm 依赖检查时，`install-lefthook.mjs` 拒绝该 hooks ownership marker，3081 未监听且 Nginx 返回 502。

系统已立即回滚到 `/opt/dsh/releases/knowledge-http-auth-e0fa3f599c`。回滚后 3081 和 5173 恢复监听，外部未认证页面返回预期 401，`NRestarts=0`。候选 release 保留用于调查，但未激活；本轮不继续尝试其他部署方法。

## 文案上线结果

完整 workspace 候选因 pnpm 绝对依赖状态和 hooks 标记不适合直接换路径。本轮改用单文件构建产物部署：备份当前 `packages/client/ui-enterprise-workbench/lib/client.js` 到 `/opt/dsh/backups/ui-enterprise-workbench-client.js.before-my-devices-20260921`，再原子替换客户端文件并重启原 release。

重启后 `dsh-enterprise` 为 active，`NRestarts=0`，3081 与 5173 均监听。Chrome 实际刷新并打开工作台后，导航按钮和页面标题均显示“我的设备”，页面说明显示电脑与录音卡的不同用途，“连接此电脑”保持为电脑专属动作。

# ASR 与 CAM 设置部署记录

[English](2026-09-22-asr-cam-settings-deployment.md) | 中文

## 已交付状态

47 Host 已运行 release `/opt/dsh/releases/recorder-runtime-settings-20260922-afdc090500`，源码提交为 `afdc0905001b2681cb1af3ce26942a15e89e9ff9`。系统设置新增显性的“录音与语音模型”页面，ASR 与 CAM 均可选择本地或在线模式，配置模型、在线端点和 Credential 引用；页面同时提供本人匹配阈值，以及相互独立的保存、启动/重载和刷新操作。

已部署本地运行时显示 ASR 模型为 `paraformer-zh`、CAM 模型为 `cam++`、本人匹配阈值为 `0.72`，两个模型均已就绪。浏览器中的“启动 / 重载”操作完成后，页面读回“运行中 · v1”“ASR 已就绪”和“CAM 已就绪”。ASR 与 CAM 的在线模式字段均已实际渲染验证，测试选择没有保存，因此活动配置仍保持本地模式。

## 部署与凭据

发布包只包含 Git 已跟踪源码和已验证构建产物，排除了 `.env`、`.git`、未跟踪文件和本地凭据。录音网关使用同一 release 中的源码更新。ASR token 与录音管理 token 已在 Mac launchd 服务、47 网关和 DSH 企业环境之间完成轮换，过程没有记录 token 值。临时 token 文件已删除，本次部署创建的备份中也已抹除旧 ASR token。

备份和回滚元数据位于 `/opt/dsh/backups/20260922-asr-cam-settings`。`previous-release` 记录旧 release 路径；回滚时把 `/opt/dsh/current` 切回该路径，恢复保存的网关源码和环境文件，并重启 `recorder-gateway`、`recorder-memory-worker` 与 `dsh-enterprise`。旧 ASR token 已在轮换后失效，因此回滚仍须在网关与 Mac launchd 配置中保留当前 token。

## 验证

- 录音设置 UI 与 Host bridge：8 项定向 Vitest 通过。
- 录音 ASR 服务：使用服务虚拟环境运行的 107 项 Python 测试通过。
- 录音网关：9 项 Python 测试通过。
- 数字员工身份回归：Agent Preset 与企业 Controller 共 25 项定向测试通过。
- DSH/Web 完整构建和 pre-push Host/Client 类型检查通过。
- Mac 服务与 47 网关的真实读回均显示本地 ASR、CAM 已就绪，凭据状态满足运行要求。
- 部署后 `dsh-enterprise`、`recorder-gateway`、`recorder-memory-worker`、Nginx 与 PostgreSQL 均为 active。

DSH 首次启动仍触发了既有的客户端模块注入顺序竞态（`webServer` 尚未注入）；systemd 自动重启一次后第二次启动保持 active。本记录保留该重启事实，不把最终进程 active 当作启动过程完全无异常。

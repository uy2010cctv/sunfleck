# 录音本地模型设置合并记录

[English](2026-09-22-recorder-local-models-consolidation.md) | 中文

## 交付状态

系统设置现在只保留一个“本地模型”入口管理录音链路。原来的独立“录音与语音模型”导航项已移除。“本地模型”页面包含原有 ASR、CAM 控制，以及新增的“记忆加工模型”卡片，可设置 Provider、模型、超时，并显示只读的专用 Session ID。

专用 Session ID 根据已登录用户生成。线上管理员页面读回 `recorder-memory-bootstrap-admin`。ASR 仍为 `paraformer-zh`，CAM 仍为 `cam++`，两个本地服务均显示已就绪。记忆加工当前配置为 Provider `zai-coding-cn`、模型 `glm-5.3-flash`、超时 15,000 毫秒。

## 持久化与执行

保存记忆路由后，系统使用原子写入将配置保存到 `/root/.dsh/storages/recorder-memory-runtime.json`，文件权限为仅所有者可读写的 `0600`，schema 版本为 `1`，并校验单调递增的 revision。线上首次保存产生 revision `1`。知识插件在每批录音记忆加工前读取该文件，因此后续修改无需重启 worker 即可生效。只有配置文件不存在时，旧环境变量才作为迁移兼容值使用。

ASR/CAM 的“保存配置”和“启动 / 重载”与“保存记忆配置”保持独立，修改语言模型路由不会重启本地语音服务。

## 部署与验证

- DSH 源码提交：`4fccf500fd46cdf01e6385bdaa393ebfd1cdbf30`
- 47 当前 release：`/opt/dsh/releases/recorder-local-models-20260922-4fccf500fd`
- 知识插件：`0.3.11-enterprise.15`，源码提交 `b3c401b`
- DSH 聚焦验证：5 个测试文件、11 个测试通过；完整构建与推送前 Host/Client 类型检查通过。
- 知识插件聚焦验证：13 个测试、类型检查与构建通过。
- 浏览器验收确认统一导航、三个模型配置区、专用 Session ID 和“配置已保存”回读。
- 服务端读回确认文件权限 `0600`、revision `1`、三个服务均为 active，且本 release 的 `dsh-enterprise` 重启次数为 `0`。

回滚元数据与旧 profile 包保存在 `/opt/dsh/backups/20260922-recorder-local-models`。

# 录音卡 ASR / CAM 显性设置改动记录

[English](2026-09-21-asr-cam-runtime-settings.md) | 中文

时间：2026-09-21。

## 本轮目标

将原来隐藏在 Mac 进程环境变量中的 ASR 与 CAM 选择放到 SUNFLECK 系统设置，同时保留服务端凭据隔离、配置版本和真实启动状态回读。

## 修改

- 新增“录音与语音模型”设置页，ASR 和 CAM 分别选择本地模型或在线模型。
- 本地配置包含模型 ID；CAM 额外包含启用开关与本人声纹阈值。
- 在线配置只提交 HTTPS 端点和 Credential 引用。真实密钥由 DSH Host 解析，不返回浏览器。
- 增加 DSH Host → 47 网关 → Mac ASR 的管理路径，前两段分别使用服务端管理 token 和 ASR token。
- Mac 以 0600 权限原子写入带 revision 的 `runtime.json`。旧页面保存时版本冲突会失败，不会覆盖新配置。
- “保存配置”与“启动 / 重载”分开。启动先加载候选后端，对已选在线厂商发送一秒静音推理探针，所有检查成功后再替换当前推理对象。
- 本地 ASR 支持 FunASR/Paraformer 和 faster-whisper；本地 CAM 支持 CAM++。
- 在线 ASR 接 OpenAI 兼容的音频转写协议；在线 CAM 接 HTTPS JSON embedding 协议。
- 将 Mac ASR 完整源码、启动模板与测试收入 `integrations/recorder-asr-service/`，避免线上运行修改只留在本机目录。

## 端点

Mac ASR 新增三个已鉴权端点：

- `GET /v1/admin/runtime`：返回脱敏配置和就绪状态。
- `POST /v1/admin/runtime/configure`：按 `expectedRevision` 持久化配置。
- `POST /v1/admin/runtime/start`：加载或热重载已保存模型。

47 网关暴露同路径代理，但必须通过 `X-DSH-Recorder-Admin-Token`。

## 验证

- ASR 服务 105 项 Python 测试通过，包含配置持久化、脱敏、版本冲突、HTTPS 限制、在线 ASR 和在线 CAM 适配器。
- 47 网关 9 项 Python 测试通过，包含管理 token 精确匹配。
- DSH 设置、Remote bridge 与鉴权分类 26 项 Vitest 测试通过。

## 待真实环境验收

- 线上模型需由用户配置真实厂商 HTTPS 端点和 Credential 后执行一次真实音频推理。
- 线上页面需部署 DSH、网关与 Mac 三端新代码后，完成保存、启动、刷新与错误回读。

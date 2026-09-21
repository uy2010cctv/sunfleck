---
description: "在 DSH 系统设置中配置录音 ASR 和 CAM 运行方式，启动所选模型，并查看脱敏的运行就绪状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-recorder

[English](README.md) | 中文

## 概述

用户可选择本地或在线的录音转写和说话人识别，保存带版本的配置，并启动或重载所选模型。页面区分已保存配置与活动运行状态，并报告 ASR、CAM 和凭据就绪状态。在线模式只接受 Credential 引用，因此密钥值不会进入浏览器状态。Web 组合提供 Enterprise 录音控制器时选择本包。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

打开“录音与语音模型”，保存期望的 ASR 和 CAM 配置，选择“启动 / 重载”，并查看返回的就绪状态。

### 适用场景

当 Web 组合包含已鉴权的 Enterprise 录音控制器和录音管理服务时选择本包。组合没有交互式系统设置应用时，使用部署所有的环境配置。

### 最小配置

在共享 Settings shell 之后挂载浏览器插件：

```yaml
- id: ui-settings-recorder
  name: '@deepseek-ai/dsh-client-ui-settings-recorder'
```

本插件没有配置字段。Host 读取 `DSH_RECORDER_ADMIN_URL` 和 `DSH_RECORDER_ADMIN_TOKEN`；这些部署值不会经过浏览器包。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现内部 — 点击展开</summary>

页面调用已鉴权的 `enterpriseDevice` Remote。Host 校验字段，解析 Credential 引用，再通过仅服务端可用的录音管理桥发送期望配置。保存操作修改期望配置；启动操作再在 Mac 运行时加载该版本。浏览器只接收模型选择、版本、就绪标记和错误，不接收凭据值。

| 区域 | 源码 |
|---|---|
| 浏览器注册与语言连接 | [`src/client/index.ts`](src/client/index.ts) |
| 可观察操作 | [`src/client/store.ts`](src/client/store.ts) |
| 设置表单与状态回读 | [`src/client/RecorderSettingsSection.tsx`](src/client/RecorderSettingsSection.tsx) |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Settings shell](../ui-settings/README.zh.md) — 拥有共享导航和区域 slot。
- [Enterprise controller](../../api/enterprise-controller/README.zh.md) — 拥有已鉴权的录音 Remote。
- [Credential 服务](../../credentials/README.zh.md) — 拥有在线厂商密钥值。
- [录音运行时决策](../../../.agents/notes/implemented/feature/2026-09-21-recorder-runtime-settings.zh.md) — 记录控制路径和密钥所有权理由。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只注册浏览器 Settings 区域，不增加模型可见输入或工具。

#### KV Cache 影响

无；本包不组装或发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

本页控制已部署的录音适配器，不转换任意厂商协议。

- 在线 ASR 需要 OpenAI 兼容的音频转写端点。
- 在线 CAM 需要 ASR 服务文档定义的录音说话人 embedding JSON 协议。
- 通用在线协议没有共通健康路由，因此启动会先发送一秒静音推理探针，成功后才报告厂商就绪。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变式：**不发布 companion。本页拥有一个 Settings 注册和可观察的浏览器状态；Host 和录音服务拥有持久化和模型进程。

# 录音本地模型设置合并实施计划

[English](2026-09-22-recorder-local-models-consolidation.md) | 中文

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 在同一个“本地模型”页面配置 ASR、说话人识别和录音记忆加工模型，并持久保存记忆模型路由、显示专用 Session id。

**架构：** dsh-knowledge 继续拥有“本地模型”页面，并提供录音推理子插槽。DSH 录音设置插件填充该插槽；企业 Controller 把记忆加工路由持久保存到 `$DSH_HOME/storages/recorder-memory-runtime.json`，dsh-knowledge 每次加工前读取同一文件。

**技术栈：** TypeScript、React、Cordis slots、Typert Remote、JSON 原子持久化、Vitest、Python worker 集成。

---

### 任务 1：持久保存记忆加工路由

**文件：**
- 新建：`packages/api/enterprise-controller/src/recorder-memory-runtime.ts`
- 修改：`packages/api/enterprise-controller/src/contract/devices.ts`
- 修改：`packages/api/enterprise-controller/src/index.ts`
- 测试：`packages/api/enterprise-controller/tests/recorder-memory-runtime.spec.ts`

- [ ] 先写失败测试，证明按 revision 写入 `{provider, model, timeoutMs}`，读取时返回 `recorder-memory-<userId>`。
- [ ] 运行定向 Vitest，确认因存储/API 尚未实现而失败。
- [ ] 在 `dshHomePath('storages')` 下实现仅属主可读的原子 JSON 持久化，使用 `ctx.llm` 校验 provider/model，并暴露鉴权 get/save Remote。
- [ ] 重跑 Controller 定向测试并确认通过。

### 任务 2：让记忆加工读取持久路由

**文件：**
- 在 dsh-knowledge 新建 `src/knowledge/recorder-memory-config.ts`
- 在 dsh-knowledge 修改 `src/knowledge/recorder-memory.ts`
- 在 dsh-knowledge 修改 `tests/recorder-memory.spec.ts`

- [ ] 先写失败测试：保存路由文件后，`processRecorderMemory` 应使用该文件而不是旧环境变量。
- [ ] 运行定向测试，确认模型路由不一致。
- [ ] 实现有界 JSON 解析；文件不存在时保留环境变量迁移回退；专用推理 Session id 继续使用 `recorder-memory-<userId>`。
- [ ] 重跑记忆加工测试并确认通过。

### 任务 3：把录音控制合并进本地模型

**文件：**
- 修改 dsh-knowledge 的 `src/ui/client/index.tsx` 与 `src/ui/client/LocalModelsSection.tsx`
- 修改 DSH 的 `packages/client/ui-settings-recorder/src/client/index.ts`
- 修改 DSH 的 `packages/client/ui-settings-recorder/src/client/RecorderSettingsSection.tsx`
- 修改 DSH 的 `packages/client/ui-settings-recorder/src/client/store.ts`
- 修改 DSH 的 `packages/client/ui-settings-recorder/src/client/locales.ts`
- 测试：两个包的本地模型与录音设置 client 测试

- [ ] 先写失败 slot 测试，证明不再注册独立录音设置页，而是挂到 `settings.local-models.recorder`。
- [ ] 先写失败组件/store 测试，覆盖模型选择、专用 Session id 和相互独立的保存状态。
- [ ] 增加本地模型子插槽并在标题后渲染；把录音设置注册进去；保存时用活动模型目录校验 Provider/模型。
- [ ] 运行两组 client 测试和 Impeccable 检查。

### 任务 4：验证、记录和部署

**文件：**
- 更新 recorder-sync 中的实施与部署双语 Markdown。
- 持久配置决策落地时更新对应 Agent Note。

- [ ] 运行定向 TypeScript、dsh-knowledge 测试、双方构建、双语配对和 `git diff --check`。
- [ ] DSH 合并到 `master`，dsh-knowledge 合并到 `main`。
- [ ] 在 47 安装两个 release，保留回滚备份。
- [ ] 在一个“本地模型”页面核对 ASR、CAM、记忆加工模型和专用 Session id，验证保存后读回，并用所选路由加工一个录音批次。

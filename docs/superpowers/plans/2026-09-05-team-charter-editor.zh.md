# 团队章程编辑闭环实施计划

[English](2026-09-05-team-charter-editor.md) | 中文

> **面向 DSH 维护者：** 每项任务先写测试，并保持 Team Definition 为唯一章程写入契约。

**目标：** 补齐浏览器端新建团队章程、完善迁移后的 `needs-charter` 草稿、保存草稿，以及启用完整受治理章程的闭环。

**架构：** 在企业工作台控制器中新增版本化 Team Definition 写入，再在团队指挥台提供统一的内联章程编辑器。编辑器把面向业务用户的输入映射到 Host 已校验的类型化名册、角色、验证、注意力、审批、可见性和修订字段。Team Run 启动保持独立，并且只能接受已生效修订。

**技术栈：** React、TypeScript、CSS Modules、生成式 Enterprise Remote 契约、Vitest、Testing Library。

---

### 任务一：接通类型化 Team Definition 写入

**文件：**
- 修改：`packages/client/ui-enterprise-workbench/src/client/store.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/index.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- 测试：`packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`

1. 先增加失败的控制器测试，证明 `enterpriseTeamDefinition.save` 收到章程字段与单一幂等键，并刷新 Team Definition 投影。
2. 在控制器和浏览器注入契约中增加 `saveTeamDefinition`，并接入冲突后重载。
3. 运行聚焦 store 测试。

### 任务二：构建“新建/完善章程”流程

**文件：**
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- 修改：`packages/client/ui-enterprise-workbench/src/client/locales.ts`
- 修改：`packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.module.css`
- 测试：`packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`

1. 先增加失败的 UI 测试，覆盖打开空白章程、打开迁移草稿、保存草稿和启用完整章程。
2. 把不可操作的章程行改为可访问的“选择”和“编辑”双操作。
3. 增加响应式内联编辑器，覆盖身份、北极星、Human 负责人、可见范围、Agent 名册、领队、验证者与治理项。
4. 逐步展开高级并发限制，把所有字段映射为类型化 Team Definition 数据，不暴露 JSON。
5. 仅在保存成功后清除脏状态，并在保存或取消后回到章程列表。

### 任务三：验证体验、契约与部署

1. 运行聚焦 store、workbench、样式和方向性测试。
2. 运行类型检查与包构建。
3. 对变更的 UI 文件运行一次 Impeccable 检测，并修复有效问题。
4. 提交隔离分支，在不覆盖用户无关改动的前提下集成当前工作区，重启 3081 端口的 DSH，并在不保存测试业务数据的情况下浏览器验收新建、完善和取消流程。

---
description: "工作区文件目录界面：侧边栏触发器加浮层面板，展示当前会话工作区的文件树；面向工作区文件浏览体验的使用者与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace-files

[English](README.md) | 中文

## 概述

本包为 Web GUI 提供工作区文件目录界面：点击侧边栏底部的触发器，会在右侧打开一个抽屉面板，展示当前会话工作区目录（会话 cwd）下的文件树。目录按需逐层展开，每次通过 Host 的文件引用发现服务取回一层——与 `@` 提及菜单使用同一套相对路径词汇表，因此文件树与提及菜单对工作区内容的认知始终一致。本插件是面向人的只读投影，不发起任何变更类 RPC。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将本插件挂载到 Web roster 中即可。侧边栏底部（设置按钮旁）会出现一个文件夹触发器，点击可开关抽屉。抽屉头部显示工作区短名与完整路径，并提供刷新与关闭按钮。默认列出工作区根目录；点击目录可展开或折叠，首次展开时加载该层内容。当前会话没有工作区目录时，抽屉显示空状态而不是报错。

### 数据来源

每一层内容来自 Host 的文件引用发现服务（`ctx.remote.fileReferences.list`，入参为会话 id 与相对目录查询：`''` 表示工作区根目录，`'dir/'` 表示子目录）。隐藏条目与被排除的目录由 Host 过滤，规则与 `@` 提及菜单完全一致——提及菜单里看不到的目录，文件树里也不会出现。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节 — 点击展开</summary>

本包注册两个可叠加的插槽条目，共用同一个 `workspace-files` id：

- `sidebar.footer.action` — 触发器按钮。通过 inject 的 `hooks` 舱读取共享的开关状态 store（`useWorkspaceFiles`），因此按钮的按压态与抽屉的可见性永远不会不一致。
- `shell.overlay` — 抽屉本身。通过标准 `useSessions` hook 读取当前会话及其 cwd，再通过注入的 `listLevel` 回调（绑定到文件引用 remote）逐层取数。

两个条目共享一个在 `apply` 中创建的 `SnapshotStore<{ open: boolean }>`，经各自注册的 `inject` `hooks` 舱传入。各层的子项按目录键缓存在组件状态中；抽屉关闭、会话切换或树重置时，代数计数器与 `AbortController` 会使进行中的扫描失效，迟到的结果永远不会污染已关闭的抽屉。
</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [`dsh-client-ui-reference`](../ui-reference/) — 与文件树共享同一套文件发现词汇表的 `@` 提及菜单。
- [`dsh-file-reference-local`](../../context/file-reference-local/) — 解析各层列表的 Host 服务。
- [`dsh-client-ui-workspace`](../ui-workspace/) — 本插件所补充的工作区/会话浏览区域。

-----

<a id="model-experience"></a>
## 模型体验

### 工作区浏览

#### 模型可见内容

无。浏览器通过 `ctx.remote.fileReferences.list` 为抽屉读取列表；本包不增加工具或提示词分区。模型的文件系统工具与 `@` 提及菜单保留各自的上下文行为。

#### Token 影响

零 token。抽屉列表不进入 Session 历史。

#### KV Cache 影响

无；浏览或刷新抽屉不组装提供方请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 每层数量受 Host 文件发现 `maxResults` 上限约束（默认 20）；超过上限的目录会被截断。调高 `file-reference-local` 行的上限可同时放宽文件树与提及菜单的限制。
- 抽屉只展示名称——暂无大小、修改时间或"在编辑器中打开"等操作。
- 文件树不会实时跟随文件系统变化；点击刷新按钮按需重新读取各层。

-----

<a id="dev-note"></a>
### 开发备注

使用 `pnpm --filter @deepseek-ai/dsh-client-ui-workspace-files run bundle`（或 dev-web 监听循环）重新构建客户端 bundle。抽屉出现前需要 web 运行时重新提供该 bundle；客户端 HMR 链会在产物变化时重载该条目。

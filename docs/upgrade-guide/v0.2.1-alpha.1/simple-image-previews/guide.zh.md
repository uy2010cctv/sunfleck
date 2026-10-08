---
kind: upgrade-guide
description: "独立的简单图片标签显示为图片，不再按 HTML 文字展示。"
---
# 独立图片预览

[English](guide.md) | 中文

## 变更

独立的 `img` 标签仅含 `src`、`alt`、`title`、`width` 和 `height` 属性时，在消息落定后渲染为 Markdown 图片。重复属性、其他属性、代码示例及不支持的协议保持惰性。调用方现有的文件解析与鉴权继续生效。宽高属性不控制布局。可点击图片使用完整保留内容的 240px 预览，点击后打开共享原图对话框。

## 迁移

1. 新消息使用 Markdown 图片语法。需要展示 HTML 图片示例的源码时，用代码块包裹。
2. 本地图片路径保持相对于当前查看的工作区，或使用绝对路径；本地文件仍须存在且可通过配置的文件系统访问。
3. 验证现有简单图片标签显示为缩略图，点击后打开原图。参见 [Markdown 渲染器](../../../../packages/client/ui-primitives/README.zh.md#rendering-agent-output)。

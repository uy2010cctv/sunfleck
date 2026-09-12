# Agent Note：冷态空 Session 列表

Status: implemented

[English](2026-09-12-cold-empty-session-listing.md) | 中文

## 问题

Host 重启后，PostgreSQL Session 处于冷态。投影缓存缺失时，Session 列表之前会把空白性当成未知并显示。因此，仅含 seed 和权限事件的失败或放弃 Session，会显示成多条普通“新会话”，尽管它们从未开始对话。

## 决策

持久化快照增加可选的轻量 `conversationStarted` 证据。PostgreSQL 通过对 `turn/start` 的索引存在性检查得到它，不加载也不重放完整日志。Session Query 为持久冷态记录保留该证据；当 PostgreSQL 证明尚未开始任何 turn 时，Session Controller 把缓存缺失的冷态行分类为空白。Client 原本就只显示当前空白行，所以过期空壳会消失，活动草稿仍可复用。

无法低成本确定的后端保持字段缺省，继续采用之前的保守显示策略。真实 `turn/start` 始终保证 Session 可见，即使标题生成或投影缓存失败。

## 考虑过的替代方案

**隐藏所有无标题 Session。** 这可能隐藏标题生成失败的真实对话，因此被拒绝。

**列表时加载每个冷态日志。** 大型对话可包含数十万个流式事件，为绘制侧边栏重放它们会让启动变得不安全。

**删除空 Session 记录。** 删除不可逆，而且把展示与保留策略混在一起。已确认的重复项应另行归档。

## 后果

PostgreSQL 支撑的企业部署重启后，不再把过期空壳显示为对话。列表查询每个 header 增加一次有界相关存在性检查，并由 Session ID 事件索引支持；其他持久化后端继续保持保守行为。

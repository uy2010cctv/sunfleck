# Agent Note: Enterprise work-start reservation

Status: implemented

[English](2026-09-07-enterprise-work-start-reservation.md) | 中文

## Problem

此前的工作启动流程会在 WorkRecord 幂等写入之前创建并绑定原生 Session。持久化失败后，没有持久 admission 证据能够阻止变更后的重试继续触达原生副作用。

## Decision

Enterprise Operations 拥有一条以组织、用户和幂等键为键的 PostgreSQL work-start reservation。它保存 canonical 请求指纹、已解析的 Session、Workspace、release、preset、允许保存的截止日期值/摘要，以及 `starting` 或 `completed` 生命周期。Controller 会在 create/bind 前预留，重试时使用已存快照，并且仅在 WorkRecord upsert 后标记完成。

## Alternatives considered

**仅使用 WorkRecord 幂等性。** 当原生 Session 副作用之后的写入失败时它会丢失 admission 边界，因此不能安全地拒绝变更后的重试。

**新增 Remote namespace。** 这会暴露内部恢复机制并扩大浏览器 API；已有的 `enterpriseWork.start` 仍是唯一面向用户的工作启动方法。

## Consequences

该 reservation 阻止同一键但 canonical 输入已变化的请求创建第二个 Session，并让重启后的实例可使用同一个确定性 Session ID 完成部分启动。每次工作启动会增加一条持久生命周期记录；它不宣称外部副作用恰好一次：原生 create/bind 仍必须能容忍对已存 Session ID 的重试。

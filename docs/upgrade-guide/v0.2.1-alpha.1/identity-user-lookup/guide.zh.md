---
kind: upgrade-guide
description: "自定义企业身份存储必须实现按组织限定的单用户查询。"
---
# 企业身份单用户查询

[English](guide.md) | 中文

## 变更

`EnterpriseIdentityStore` 要求实现 `findUserById(orgId, userId)`。资源授权通过此方法读取单个当前人类用户。提供自定义 `identityStore` 的部署必须更新适配器；内置 SQLite 和 PostgreSQL 适配器已实现此方法。

可选方法 `sessionAccessFacts` 支持批量 Session 列表授权。自定义存储可以省略它并保留逐条访问读取。实现必须仅返回请求 id 的当前事实，包括其他组织的协作绑定，供授权层拒绝。

## 迁移

1. 在自定义 `EnterpriseIdentityStore` 实现中添加 `findUserById(orgId, userId)`。返回当前 `EnterpriseUserView`，包括角色、部门和停用状态；用户不在请求组织内或不存在时返回 `undefined`。支持同步结果或 Promise。
2. 每次调用读取当前记录，不跨请求缓存权限。
3. 对适配器执行类型检查，并确认组织不匹配时返回 `undefined`，成员关系变更在下一次读取时可见。

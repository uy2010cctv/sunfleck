# @deepseek-ai/dsh-enterprise-catalog

[English](README.md) | 中文

基于 DSH 原生身份的版本化企业目录：

- Agent Preset ID 仍是数字员工的权威身份。
- 草稿使用乐观 revision 和幂等保存。
- 管理查询始终限定在单一组织内，使用参数化过滤，并按 `updatedAt` 和 ID 的稳定顺序通过 HMAC-SHA256 签名的不透明游标分页。
- 发布版本是带确定性 SHA-256 摘要的不可变快照。
- SOP、知识、技能、工具和模型资产均支持版本，并绑定到员工版本。
- 资产归档是带 revision 检查的逻辑写入；幂等键与请求摘要绑定，完全相同的重试返回原始结果。
- 拒绝明文密钥；运行时凭据只使用 `credentialRef` 引用。
- PostgreSQL 写入使用调用方事务，所有查询均参数化。
- 分页索引覆盖组织、更新时间和资源 ID；表达式索引覆盖小写资源 ID 和资产名称，不要求 `pg_trgm`。

生产仓库以 `Buffer` 或字符串提供稳定的 `cursorSigningKey`。未配置密钥的仓库仅能读取不需返回游标的首页；生成或消费游标会明确失败。轮换密钥会使未完成的游标失效。

## 模型体验

### 目录持久化

#### What the model sees

无。目录只存储控制面元数据和发布快照，不增加 Prompt、Message、Tool 或模型调用。

#### Token effect

零 Token；只有发布后的员工进入既有 DSH Session 时才产生模型成本。

#### KV Cache effect

无；目录写入不组装提供方请求。

## 已知限制与暂缓事项

- 本包提供目录仓库和合同；Host API 组合与浏览器页面属于独立层。
- 设置 `DSH_TEST_POSTGRES_URL` 时运行 PostgreSQL 集成测试，CI 中必须设置。

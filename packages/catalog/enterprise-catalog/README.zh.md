# @deepseek-ai/dsh-enterprise-catalog

[English](README.md) | 中文

基于 DSH 原生身份的版本化企业目录：

- Agent Preset ID 仍是数字员工的权威身份。
- 草稿使用乐观 revision 和幂等保存。
- 发布版本是带确定性 SHA-256 摘要的不可变快照。
- SOP、知识、技能、工具和模型资产均支持版本，并绑定到员工版本。
- 拒绝明文密钥；运行时凭据只使用 `credentialRef` 引用。
- PostgreSQL 写入使用调用方事务和参数化查询。

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
- 真实 PostgreSQL/JSONB 集成测试属于部署门禁。

# @deepseek-ai/dsh-knowledge-pgvector

[English](README.md) | 中文

DSH 企业知识的 PostgreSQL/pgvector 持久化层：

- 文档拥有不可变的递增版本，原件只通过来源引用记录。
- Chunk 接收调用方提供的 embedding，本包不调用 embedding 服务。
- 检索在 SQL 中强制限制组织、用户、群组和角色 ACL。
- 检索结果携带文档版本、内容摘要、Chunk 标识和权限证据。
- 文档和 ACL 写入使用乐观 revision、事务级 advisory lock 和幂等键。
- 迁移创建 `vector` 扩展、本包表结构并保护 schema 版本。

## 模型体验

### 知识检索

#### What the model sees

模型只能看到 Host 通过 ACL 过滤后传入的 Chunk；仓库不组装 Prompt，也不调用模型。

#### Token effect

检索本身不消耗模型 Token。Host 将返回的 Chunk 写入 Prompt 后，按 DSH 正常模型调用计费。

#### KV Cache effect

仓库层无影响；缓存行为由 DSH Session/Provider 运行时负责。

## 已知限制与暂缓事项

- embedding 生成、文档抽取、产物存储和 Host API 接入属于独立层。
- 首版使用不限定维度的 `vector`，以兼容不同模型；固定 embedding 模型后，部署方应添加对应维度的索引。
- 可选 PostgreSQL 集成测试需要 `DSH_TEST_POSTGRES_URL`，且 PostgreSQL 必须安装 pgvector。

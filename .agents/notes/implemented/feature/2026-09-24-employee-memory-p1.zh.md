# Agent Note: 员工跨会话记忆

Status: implemented

[English](2026-09-24-employee-memory-p1.md) | 中文

## 问题

被呼叫的数字员工在会话之间什么都不记得：每次对话只从已有的 SOP 和技能绑定重新开始，私人工作经验无处沉淀。已有的记忆注入把所有已批准的组织和部门记忆放在一次不过滤所有者的列表里，渲染成无标签、按取回顺序排列的平面清单。写回管道只能落入两条共享轨道，员工的个人工作风格要么污染共享记忆，要么被丢弃。

## 决策

企业记忆现在有五个隔间——`organization`、`department`、`project`、`agent`、`pair`——作为同一个 `enterprise_memories` 表的 scope 值存储，两套身份存储镜像（SQLite schema v7、PostgreSQL v6）。`agent` 行必须携带非空 `agent_employee_id`，`pair` 行必须携带非空 `pair_user_id`，由两套 schema 中的配对 CHECK 约束强制。

## 私有写入与 scope 感知隐私

`writePrivateMemory` 把 `agent` 和 `pair` 条目直接写成 approved 状态并按摘要幂等；私有记忆不经过评审。隐私分类按 scope 区分：提示注入和超长摘要在所有隔间阻断，personal-preference 发现只阻断共享隔间。写回 worker 把携带该发现的共享目标候选降级写入行为人自己的 agent 隔间，而不是丢弃——个人偏好被私下保留，永不进入共享记忆。

## 回忆注入

`system-prompt/assemble` 监听器把已批准记忆注入为一个 `<enterprise-memory>` 上下文块。组织和部门隔间保持既有的不过滤所有者可见性；`agent` 和 `pair` 隔间只为锚定员工的会话取回，每次取回都带显式 scope 和会话自己的所有者，因此他人的私有行在构造上无法进入。条目按隔间标签渲染（`[Organization memory]`、`[Department memory]`、`[My notes]`、`[Collaboration preference]`），按关键词命中、重要度、新近度排序，按排名适配 `maxEntries`/`maxChars` 预算，并在注入时触达 `last_access_at`。

## 记忆工具

五个模型可见工具覆盖存储：`memory_search`、`memory_read`、`memory_write`（仅 agent 隔间）、`memory_retire`（仅自己的 agent 与 pair 行）、`promote_proposal`（组织或部门，进入管理员评审）。行为人解析串联已认证请求主体、表面锚定员工和工作区授权：锚定三元组经 `EmployeeAccountService.resolveSessionActor` 从会话的私信表面行读取，会话 cwd 的工作区授权提供组织和部门。`promote_proposal` 对个人偏好返回结构化结果 `{ proposed: false, reason: 'personal-preference' }` 而不是工具错误。工具调用经既有 `tool/call` 事件记录为会话日志，模型可见的内容都能从日志重建。

## 治理

企业控制器向管理员开放员工记忆：列出一名员工的记忆、评审提案（批准或否决，带修订冲突检测）、退役已批准条目。工作台员工详情渲染记忆视图和提案队列，客户端文案全部由 locale 字典承载。

## Alternatives considered

**每个隔间一张表。** 分表会在每个隔间重复摘要幂等规则、评审状态机和回忆取回。同表 scope 保住一条管道；配对 CHECK 约束承载各隔间的归属规则。

**保留平面无过滤注入。** 取回所有已批准共享行、不加标签和排序更简单，但它无法告诉模型哪些陈述是员工自己的笔记，而且扩展到私有隔间后会把一名员工的行泄漏进另一名员工的上下文。带标签、按授权过滤的隔间既保住共享行为，也让私有回忆安全。

**自动批准晋升提案。** 晋升本可以照搬自动保存立即生效。共享记忆比员工活得久，并把陈述归到组织名下，所以管理员评审队列仍是控制点。

**从会话 cwd 解析员工。** 计划最初从 `homeWorkspacePath` 匹配推导锚定员工。落地实现改为读取表面行，因为表面已经把组织、用户、员工绑定到活跃会话，而 cwd 匹配要重新推导归属，且共享同一个家工作区根目录的员工会出错。

## Testing

跨会话验收测试经公共 API 驱动真实链路：会话 A 通过 `memory_write` 在真实 `EmployeeAccountService` 与表面行之上写 agent 笔记；新会话 B 组装后看到该笔记位于 `[My notes]` 之下；从会话 B 发起 `promote_proposal` 落入 proposed 的组织行，`reviewMemory` 批准后在下一次组装中出现在 `[Organization memory]` 之下。包测试覆盖两套存储实现、scope 感知隐私、写回分流、回忆过滤与渲染、每个工具的成功与失败路径，以及治理端点和工作台切片。PostgreSQL 集成套件沿用既有 skip 规则。

## 后果

员工现在跨会话保留私人经验，共享晋升进入可运行的管理员队列。私有回忆的安全属性活在取回形态里——每个私有列表都带显式 scope 加所有者——而不是共享列表上的过滤器，新增共享取回必须保持该形态。回忆排序是词法加新近度；重要度写入默认为 0，尚无仓储 API 修改它。新模型可见工具的 recorded-session 快照属于 owner-local：本环境没有 `DEEPSEEK_API_KEY`，企业组合需要它的 PostgreSQL 环境，而且没有录制出会话 JSONL 的场景目录不能入库——corpus 策略会拒绝不拥有任何选中 Session 角色的场景。owner 在密钥和企业环境（见 `apps/cli/config/enterprise.cordis.patch.yml`，该补丁挂载本插件）就绪后用 `DSH_SNAPSHOT=record` 录制，并在入库前审查完整 diff。

## Deferred

project 隔间写入方（scope 已就绪 CHECK，但尚无写入方）、带衰减和重要度修改的整合、同一 `EnterpriseIdentityStore` 接口背后的 pgvector 升级、五个记忆工具的 Web 客户端工具卡片、把已批准的共享提案归属回发起员工。

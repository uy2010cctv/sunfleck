# 企业记忆整理运行时

[English](2026-09-23-enterprise-memory-consolidation-runtime.md) | 中文

整理规划与 LLM 精炼此前落成了纯模块，却没有任何调用方真正写回数据。运行时现在接管定时器生命周期、分区的阶段顺序和手动触发端点，也是第一个把接替、衰减批次和反思原语落成存储写入的消费方。

定时路径只处理 `consolidationOrgIds` 列出的组织（默认为空，即默认关闭），间隔 `consolidationIntervalMs`（默认 6 小时；`0` 表示关闭）。存储层虽然暴露了 `listOrganizations`，但默认"所有组织"会在首次启动时就发起未配置的全组织模型调用，所以列出组织才是诚实的显式开启；启用定时还要求 `service:` 整理行为人和 provider/model 路由，全部在插件加载时响亮校验。手动端点 `POST /enterprise/consolidation/run` 始终按组织可用，并与定时路径共用同一个进程内分区在途保护（定时遇到即在途跳过），因此把定时路径启用在多台主机上在构造上就是不安全的。

摘要接替沿存储自身的规则。`supersedeMemory` 拒绝非 approved 行，因此一条停在 `proposed` 的摘要会永远阻塞之后的每一条摘要；整理因此在通过分区感知隐私门禁后立即启用自己的摘要，并接替上一条已启用摘要，保持确定性的摘要编号链。重新生成的摘要与在生摘要相同时记为 `unchanged`，不写任何数据。P3 中项目分区推迟摘要，但结构阶段照常运行。

纯停用没有专属的存储 API——`supersedeMemory` 要求一条接替行——所以衰减条目经评审 CAS 路径停用，整理行为人作为评审者；修订号过期会被记录为失败，由下一次运行重试。department 目标的反思在 P3 保持 failed-with-reason，因为 agent 笔记只携带员工编号，且没有已挂载的服务能解析作者的部门。

衰减与停用共用一个时钟，运行时把它花在停用上：重要度批次从不写 `lastAccessAt`，因此连续运行会把完整的锚点龄期因子重新乘到已衰减的值上，未被触碰的条目以快于半衰曲线的速度复合衰减，直到（还需访问时钟过期的）停用条件触发。连同权重一起写时钟会得到精确的半衰轨迹，却会在每次运行时重置 `retirePlan` 的过期判定、彻底废掉停用；召回仍是唯一的时钟写入方。未挂载 `llm` 服务时，反思阶段标记 `skippedLlm`，与摘要的 `skipped-llm` 对应；重新生成与已被拒绝摘要完全相同的文本会以其确定性编号重新提案，并因存储编号冲突响亮失败，而不是伪装成 `unchanged`。

验证包括基于 SQLite 身份仓库的真实存储运行时测试（接替、衰减、停用、摘要的 written/unchanged/privacy-skip/llm-skip、反思的 propose/drop/fail、重入、定时器生命周期、配置边界）、覆盖 200/401/403/400/409/503 的控制器端点测试，以及全仓库 typecheck。

Task 4 补上写入侧与结项闭环。存储的直写路径从两个私有分区扩展到按成员准入的 `project` 分区：`writePrivateMemory` 对 project 范围现在要求恰好一个 `projectId`，共享隐私策略在该范围拦下所有发现（与 organization、department 一致），去重谓词覆盖新范围使两个存储对重复写入收敛到 `private-memory-<digest>`。因此项目范围的知识无需评审即以已启用行进入活跃项目——这正是 L3 语义：成员资格就是评审——而内容仍受与共享记忆相同的硬门禁。`memory_write` 接受 `scope: "project"`，`memory_search` 与 `memory_read` 对成员会话暴露该分区，且每个失败的写入门禁都是结构化工具错误，因为写入绝不能像读取解析为空那样静默无操作。

公告接入通过跨包依赖获得 D5 抽取接缝：enterprise-surface → enterprise-memory-context（无环，memory-context 不反向依赖 enterprise-surface）。memory-context 中的共享 `extractAnnouncementMemories` 辅助函数负责 strict-JSON 单次调用与逐候选的范围分类，任何失败都返回 `undefined`，让通道回落到抽取前截断提案的原样；空候选列表是有效的"无可沉淀知识"结果，不是失败。通道以确定性的 `announcement-memory-<digest>` 编号负责提案写入（重复公告收敛到既有行而不是堆叠），`ChannelIngestedDelivery` 结果从单个 `proposedMemoryId` 改为 `proposedMemoryIds` 加 `droppedPrivacy`，因为带丢弃的批次是已交付结果，不是 `privacy-gated` 失败。只有两个配置字段都给出 provider/model 路由时抽取才开启，只配置其一时在加载时响亮校验。

项目蒸馏（D6）放在一个无依赖的模块里，接收已解析的存储、模型表面、时钟和审计回调，运行时因此保持单一服务面：`ctx.memoryConsolidation.distillProject`。经验以 `project-distill-<sha256([projectId, summary])>` 编号提案，使重跑跳过已成立的条目而不是冲突，运行时对每次运行都审计——包括结构化跳过和对抛出失败的尽力记录，因为归档后的触发会吞掉拒绝。控制器把该接缝直接挂载为运行时服务本身（免分支的组合装配）：手动路由做成员门禁并把不存在折叠为 404，归档路由不等待地触发蒸馏——归档先落库，记忆工作绝不能阻塞或使其失败。

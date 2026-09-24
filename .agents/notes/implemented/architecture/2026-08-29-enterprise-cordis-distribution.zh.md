# Agent Note: 企业 Cordis 发行与用户扩展

Status: implemented

[English](2026-08-29-enterprise-cordis-distribution.md) | 中文

## 问题

动态 Cordis Package 是 DSH 原生能力，但仅存在于当前进程和 Session。企业用户可以在对话中创建并运行能力，却无法将其保留到个人 Workspace、提交部门治理、发布到全组织，也无法证明某个 Session 实际使用了哪个不可变版本。

## 决策

保留原生 `cordis_inspect -> cordis_define -> cordis_run -> repair` 链路作为唯一创作真源。企业层在 PostgreSQL 中增加不可变 Package 版本、作用域激活绑定、部门负责人审核、审计记录和 Session Generation 快照，不新建低代码引擎。

个人 Workspace 中成功的 `cordis_define` 会保存不可变私有版本；部门 Workspace 中则建立待审部门版本，不建立活动共享绑定。持久化 Plugin id 包含 Session id，避免进程重启后临时 id 重复。部门 Workspace 中已有的创建者私有版本可另建不可变版本提交审核，原私有版本不变。个人或部门 Workspace 成员可在该 Workspace 中激活、停止和回滚自己的私有版本。该部门任一已配置负责人可派生新的不可变版本、批准或退回，并直接发布到全组织。待审源码仅对作者和部门负责人可见，其他成员不可见。管理员保留紧急停用、回滚、负责人授权和信任等级治理权。用户 Package 默认隔离运行，且不得提供身份、授权、审计、凭据、Session 持久化、企业仓库或 Artifact Store 等受保护契约。

每个 Session 仅在首次使用 Workspace 时固定一份可见激活绑定。包含创建者私有绑定的固定 Generation 不会返回给共享 Workspace 的其他用户。默认恢复仍经过原生 Cordis 隔离 Realm、Host 生命周期、浏览器加载器和诊断链；只有组织作用域且被管理员提升为 `trusted-in-process` 的版本才使用进程内 Cordis Context 执行器。Workspace 后续升级只影响新 Session。

Package 源码以 SHA-256 内容寻址形式写入受控 Artifact Store，PostgreSQL 只保存引用、摘要、大小和治理元数据；读取时必须重新校验摘要。发布门禁同时执行恶意构造特征、密钥、Host API、许可证允许列表、依赖精确版本和 SHA-512 完整性检查；扫描器合同可追加企业防病毒与 SCA 实现，任一检查失败都不切换激活指针。

企业工作台将 Workspace 扩展表达为可运营的列表：当前运行、我的扩展、部门扩展、组织扩展、待我审核和回收站。页面默认汇总创建者在所有已授权 Workspace 中保存的版本，标明私有版本的来源工作区，并提供可选的工作区筛选。客户端合并多个工作区返回的重复组织版本；一个工作区读取失败时，其余记录仍可管理。创建者可将自己在部门 Workspace 中的私有版本提交审核、归档私有 Plugin 并恢复其不可变版本；归档与停止绑定在同一事务提交，恢复不会自动重新启用。部门分页显示有权查看的待审源码及状态，以及已批准绑定的作用范围管理操作。会话 Cordis 面板单独显示 Session 运行中的 Plugin。页面显示真实版本、作用范围、能力、隔离、源码、生命周期和审核操作，不把 Cordis 实现方式暴露成另一个搭建平台。

## 验证

领域、PostgreSQL、认证分类、Host Controller、动态 Runner、运行时恢复、前端 Controller Store 和浏览器组件测试覆盖了新链路。根目录完整构建验证 Typert 生成、Host/Client Package 以及生产 Web Bundle。

## Alternatives considered

**单独的企业低代码构建器。** 拒绝，因为它会在原生 Cordis Package 之外再建立一套作者、执行和审计模型。

**所有已发布 Package 立即进程内执行。** 拒绝，因为用户和部门作者代码必须保持隔离，直到管理员明确提升组织范围 Release。

**永久删除私有 Package。** 拒绝，因为恢复能力和已固定的 Session generation 依赖不可变源码；作用范围归档使新 Session 不再选择该 Plugin，同时保留证据。

## 影响

- 企业 Workspace 中的定义即使删除了 Session 内的临时 Plugin，源码仍然保留。企业 Workspace 外创建的定义仍是临时的。
- Package 历史只追加；回滚仅移动绑定指针，不删除源码历史。
- 部门和组织绑定只重新启用当前选中的已批准 Package；私有或待审 Package 必须走原有审核与发布链路。
- 恢复的 Client Package 仅因持久作用域绑定已记录批准，才跳过重复审批。
- 通过私有 npm Registry、tgz、Git 或受保护 Profile 安装的正式插件，与用户 Cordis 扩展在企业插件中心统一投影；私有包规格和本地路径不传到浏览器。
- 部门负责人必须先是部门成员，可多选，并由组织架构页在 revision 冲突保护下维护。

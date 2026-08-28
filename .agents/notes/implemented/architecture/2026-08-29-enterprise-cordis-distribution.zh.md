# Agent Note：企业 Cordis 发行与用户扩展

状态：已实施

[英文](2026-08-29-enterprise-cordis-distribution.md) | 中文

## 问题

动态 Cordis Package 是 DSH 原生能力，但仅存在于当前进程和 Session。企业用户可以在对话中创建并运行能力，却无法将其保留到个人 Workspace、提交部门治理、发布到全组织，也无法证明某个 Session 实际使用了哪个不可变版本。

## 决策

保留原生 `cordis_inspect -> cordis_define -> cordis_run -> repair` 链路作为唯一创作真源。企业层在 PostgreSQL 中增加不可变 Package 版本、作用域激活绑定、部门负责人审核、审计记录和 Session Generation 快照，不新建低代码引擎。

个人 Workspace 所有者可保存、激活、停止和回滚自己的扩展。部门成员可提交 Package；该部门任一已配置负责人可派生新的不可变版本、批准或退回，并直接发布到全组织。管理员保留紧急停用、回滚、负责人授权和信任等级治理权。用户 Package 默认隔离运行，且不得提供身份、授权、审计、凭据、Session 持久化、企业仓库或 Artifact Store 等受保护契约。

每个 Session 仅在首次使用 Workspace 时固定一份可见激活绑定。恢复时，系统使用不可变源码生成进程内运行标识，将已经持久授权的 Client 代码标记为已批准，但仍经过原生 Cordis 沙箱、Host 生命周期、浏览器加载器和诊断链。Workspace 后续升级只影响新 Session。

企业工作台将 Workspace 扩展表达为可运营的列表：当前运行、我的扩展、部门扩展、组织扩展和待我审核。页面显示真实版本、作用范围、能力、隔离、源码、生命周期和审核操作，不把 Cordis 实现方式暴露成另一个搭建平台。

## 验证

领域、PostgreSQL、认证分类、Host Controller、动态 Runner、运行时恢复、前端 Controller Store 和浏览器组件测试覆盖了新链路。根目录完整构建验证 Typert 生成、Host/Client Package 以及生产 Web Bundle。

## 影响

- Session 临时 Package 在用户明确保存或提交部门前始终不持久化。
- Package 历史只追加；回滚仅移动绑定指针，不删除源码历史。
- 恢复的 Client Package 仅因持久作用域绑定已记录批准，才跳过重复审批。
- 未来的正式企业安装器可消费私有 npm Registry 或 tgz，但必须投影到同一套 Package、验证、绑定、健康和审计模型。

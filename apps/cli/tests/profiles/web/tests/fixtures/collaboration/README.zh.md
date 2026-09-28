# 协作源码 Profile 测试夹具

[English](README.md) | 中文

这个无密钥夹具经由 Loader 启动受支持的 `dsh web --patch` 源码 Profile。只有外部模型适配器是确定性的；PostgreSQL、企业认证、员工发布、工作区授权、协作路由、Agent 循环和原生 Session 流均为真实服务。它验证企业 Overlay 的源码组合，不代表打包 CLI 的运行结果。两名认证人类与两名已发布 Bot 在同一房间共享事件流，测试会验证 Schnorr 签名、不同作者的公钥、持久回复以及模型发起的任务交接。频道测试覆盖线程、表情、搜索、版本化 YAML、审批、签名续跑和撤销工作区权限。回环地址收到已验签的 GitHub tag 后，Bot 起草发布说明并产生待审批记录；到期的定时工作流产生签名服务消息。Webhook 密钥每次运行只在内存生成，无效签名会被拒绝。原生 Session 保留标准工作模式和不可变员工发布版本；重新发布员工只改变新频道会话，旧群聊保留原发布版本和详情。

构建 Host 依赖、Client bundle 和 Web 前端后，执行 `DSH_TEST_POSTGRES_URL=postgresql://localhost/postgres pnpm exec vitest run apps/cli/tests/profiles/web/tests/collaboration-composition.integration.spec.ts`。未设置该环境变量时测试跳过。PostgreSQL 角色必须能创建和删除数据库，并能安装已有的 `vector` 扩展；主动执行测试时，权限不足会使测试失败。

每次运行都会生成凭据、含独立 Session Schema 的唯一数据库、私有临时 Home 和 Workspace，并使用操作系统分配的回环端口。清理过程等待 WebSocket 和进程关闭，再只删除本次生成的数据库和临时目录。并行运行之间不共享夹具状态；不需要浏览器自动化或外部模型账号。

群聊和频道上传文件（包括同事在频道线程中回复并提及另一员工的附件）转为原生文件引用；fixture 模型先用真实 `read` 工具读取其投影路径，再继续任务。组合测试检查原始存储字节与认证文件下载。损坏的 PNG 生成唯一签名拒绝记录，结束投递领取，并且不产生原生用户输入。

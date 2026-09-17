# Agent Note: 知识 HTTP 路由必须执行企业授权

Status: implemented

[English](2026-09-17-knowledge-http-enterprise-auth.md) | 中文

## 问题

Host Web server 只分发具名路由，按设计不拥有应用鉴权策略。知识插件直接注册 `/knowledge`，在建立企业主体前就会执行服务读取、请求体解析、导入和删除。反向代理暴露 DSH Web 端口后，即使 SPA fallback 与 Host API 需要登录，该路由仍会暴露。

## 决策

DSH 把 `enterpriseKnowledge.read` 分类为 `capability.read`，把 `enterpriseKnowledge.manage` 分类为 `capability.manage`，并可携带知识库资源 id。知识插件先认证企业 Session Cookie，请求中央授权决定，把决定写入现有审计存储，并在访问知识服务或请求体前通过 `EnterpriseRequestContext` 运行已允许的工作。

路由在没有主体时返回 401，动作被拒绝时返回 403，企业授权失败时返回 503。同时缺少两个企业安全服务的本地 profile 保持原有行为；只出现其中一个服务的组合会失败关闭。

发布期间，反向代理可以阻断 `/knowledge` 作为纵深防御。该规则不是授权所有者；认证路由部署并验证后可以移除。

## 验证

认证包测试固定两个端点分类。知识包测试覆盖匿名读取、读取请求体前拒绝写入、在主体上下文中允许读取、审计调用、授权服务失败、本地 profile 兼容性和实际挂载的服务路由。

## 考虑过的替代方案

**只保护 Nginx 路径。** 这会让 loopback、其他代理和未来部署继续暴露，也会阻止已认证浏览器访问，除非代理重复实现应用权限策略。

**在通用 Web server 中增加鉴权。** 该服务是企业与非企业 profile 共用的路由基础设施。让它推断应用身份会把所有路由耦合到一种认证系统。

**信任同源浏览器访问。** 同源路由只能标识网络来源，不能标识用户、角色、组织或可审计主体。

## 后果

知识 HTTP 访问与工作台共用企业身份和审计路径。原始路由所有者仍必须在领域工作前声明并调用应用授权。非企业本地 profile 不会因此依赖企业登录。

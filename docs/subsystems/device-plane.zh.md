# 设备执行平面

[English](device-plane.md) | 中文

DSH Device Plane 将企业权威控制与用户电脑上的执行分开。PostgreSQL 和经过认证的根 Session 仍是业务与审计真源；本机 Agent 只是执行端点。

## 架构

`enterpriseDevice` 负责注册设备、启动受范围约束的 Computer Use Run、排队类型化动作并记录结果。`/device-agent/v1` 使用 Ed25519 签名和防重放 nonce 认证本机进程，不使用浏览器 Cookie。`dsh-device-agent` 轮询持久队列，在执行前消费一次性 Permit，按 Run 的确认策略执行，然后调用 Adapter，并返回受限长度的摘要与证据哈希。模型创建的 Run 默认使用“授权内自动操作”（`delegated`），因此在已授予的企业范围内不会每次点击都弹窗。管理员仍可使用 `confirm-each`；业务、沙箱和不可逆操作审批保持独立。

三种 Adapter 保持分离：

- Cua Driver：用户 PC 观察与控制的主链路。它发现可见窗口、读取有界的原生无障碍快照，并执行经本机确认的元素 token 或坐标操作。
- agent-browser：启动和导航可见的隔离浏览器，并保留为结构化 DOM 后备。
- Playwright MCP：隔离的兼容浏览器后备。

系统只接受固定动作。Cua 提供窗口发现、精确窗口快照、元素 token 或坐标点击、文本输入和屏幕尺寸观察；浏览器 Adapter 提供打开、DOM 快照、点击和填写。服务端不能下发任意 CLI 参数或本机模块路径。面向模型的工具会引导可见用户 PC 工作优先走 Cua，浏览器 Adapter 只负责启动隔离浏览器或显式后备。

## 本机 Agent

构建并启动：

```bash
pnpm --filter @deepseek-ai/dsh-device-agent bundle
node apps/device-agent/lib/bin.js --server http://your-dsh-host
```

Agent 仅监听 `127.0.0.1:47631`。在 DSH 中打开 **数字员工 → 我的设备 → 连接此电脑**。同一用户范围内的同一公钥再次连接时会返回原设备，不会创建重复记录。Ed25519 私钥以仅当前用户可读的权限保存在 `~/.dsh/device-agent`，loopback 接口永不返回私钥。

浏览器 Adapter 不依赖服务账号的 `PATH`。Agent 使用自身 Node 可执行文件启动包内的 `agent-browser` 和 Playwright MCP 入口。存在已安装 Chrome 时会直接复用其可执行文件，但仍使用隔离的自动化 Profile。用户 PC 上的浏览器窗口默认可见，因此本机确认、扫码登录和人工接管都发生在用户屏幕上。受管安装可用 `DSH_DEVICE_BROWSER_EXECUTABLE` 覆盖浏览器发现，或显式设置 `DSH_DEVICE_BROWSER_HEADLESS=1` 启用后台执行。

Cua 快照向 Agent 返回有界的无障碍树，并刻意不把截图字节加入服务器结果。屏幕像素、登录二维码和无关桌面内容因此保留在配对电脑上。控制动作必须提供 Cua 返回的精确进程与窗口，再附加新鲜元素 token 或截图相对坐标。

## 安全与恢复

设备、Run、Permit、nonce、动作、结果与证据元数据都会持久化。Permit 有效期为 60 秒且只能消费一次；设备请求有效期为 60 秒，每个 nonce 只能接受一次。一个排队动作只能由一个 Agent 领取。领取后若连接结果不明，系统不会自动重复执行。如果本机 Cua SDK 返回 `session_ended`，Agent 会重建该 Run 的命名桌面会话，并对同一个正在执行的动作最多重试一次；不会创建第二个服务端动作，也不会再消费一个 Permit。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxenterprisedevicecontroller--enterprisedevicecontroller"></a>

### `ctx.enterpriseDeviceController` — `EnterpriseDeviceController`

Authenticated Device Plane pairing and heartbeat service.

```ts cordis-catalog
/**
 * List devices paired to the authenticated user.
 * @param request - Device visibility filters.
 * @returns Paired devices with derived online status.
 */
@Remote('list') async list(request: EnterpriseDeviceListRequest): Promise<EnterpriseDeviceView[]>

/**
 * List recent Computer Use runs owned by the authenticated user.
 * @param request - Optional bounded result limit.
 * @returns Recent run snapshots in update order.
 */
@Remote('listRuns') async listRuns(request: EnterpriseComputerUseRunListRequest): Promise<EnterpriseComputerUseRun[]>

/**
 * List recent Computer Use actions owned by the authenticated user.
 * @param request - Optional bounded result limit.
 * @returns Recent actions and retained evidence metadata.
 */
@Remote('listActions') async listActions(request: EnterpriseDeviceActionListRequest): Promise<EnterpriseDeviceActionView[]>

/**
 * Read one action result owned by the authenticated user.
 * @param request - Stable operation lookup.
 * @returns Current action state and retained evidence metadata.
 */
@Remote('getAction') async getAction(request: EnterpriseDeviceActionLookup): Promise<EnterpriseDeviceActionView>

/**
 * Pair a local device identity with the authenticated user.
 * @param request - Local device name, platform, and public key.
 * @returns The server-assigned device identity.
 */
@Remote('pair') async pair(request: EnterpriseDevicePairRequest): Promise<{ deviceId: string }>

/**
 * Refresh the online status of an owned device.
 * @param request - Owned device identity.
 */
@Remote('heartbeat') async heartbeat(request: { deviceId: string }): Promise<void>

/**
 * Start one governed Computer Use run.
 * @param request - Device, workspace, session, and confirmation mode.
 * @returns The new run identity.
 */
@Remote('startRun') async startRun(request: EnterpriseComputerUseStartRequest): Promise<{ runId: string }>

/**
 * Validate and queue one short-lived device operation action.
 * @param request - Governed adapter operation and required capability.
 * @returns The permit and queued action identities.
 */
@Remote('issuePermit') async issuePermit(request: EnterpriseDevicePermitRequest): Promise<{ permitId: string; actionId: string }>

/**
 * Consume a permit exactly once before local execution.
 * @param request - Operation ownership tuple.
 */
@Remote('consumePermit') async consumePermit(request: Pick<EnterpriseDevicePermitRequest, 'deviceId' | 'runId' | 'operationId'>): Promise<void>

/**
 * Pause, resume, or stop a Computer Use run using optimistic concurrency.
 * @param request - Target state and expected run revision.
 * @returns The transitioned run snapshot.
 */
@Remote('transitionRun') async transitionRun(request: EnterpriseComputerUseTransitionRequest): Promise<EnterpriseComputerUseRun>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->

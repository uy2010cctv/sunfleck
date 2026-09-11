# 设备执行平面

[English](device-plane.md) | 中文

DSH Device Plane 将企业权威控制与用户电脑上的执行分开。PostgreSQL 和经过认证的根 Session 仍是业务与审计真源；本机 Agent 只是执行端点。

## 架构

`enterpriseDevice` 负责注册设备、启动受范围约束的 Computer Use Run、排队类型化动作并记录结果。`/device-agent/v1` 使用 Ed25519 签名和防重放 nonce 认证本机进程，不使用浏览器 Cookie。`dsh-device-agent` 轮询持久队列，在执行前消费一次性 Permit，需要控制时请求本机确认，然后调用 Adapter，并返回受限长度的摘要与证据哈希。

三种 Adapter 保持分离：

- Cua Driver：原生桌面观察与控制。
- agent-browser：使用隔离 Profile 的浏览器专属操作。
- Playwright MCP：无头、隔离的兼容浏览器后端。

系统只接受固定动作：浏览器打开、快照、点击、填写，以及桌面屏幕尺寸观察。服务端不能下发任意 CLI 参数或本机模块路径。

## 本机 Agent

构建并启动：

```bash
pnpm --filter @deepseek-ai/dsh-device-agent bundle
node apps/device-agent/lib/bin.js --server http://your-dsh-host
```

Agent 仅监听 `127.0.0.1:47631`。在 DSH 中打开 **数字员工 → 我的电脑 → 连接此电脑**。Ed25519 私钥以仅当前用户可读的权限保存在 `~/.dsh/device-agent`，loopback 接口永不返回私钥。

## 安全与恢复

设备、Run、Permit、nonce、动作、结果与证据元数据都会持久化。Permit 有效期为 60 秒且只能消费一次；设备请求有效期为 60 秒，每个 nonce 只能接受一次。一个排队动作只能由一个 Agent 领取。领取后若连接结果不明，系统不会自动重复执行。

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

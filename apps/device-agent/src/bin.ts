#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { homedir, hostname, platform } from 'node:os'
import { dirname, join } from 'node:path'
import { DeviceAgentClient } from './client.ts'
import { AgentBrowserAdapter } from './agent-browser-adapter.ts'
import { CuaAdapter } from './cua-adapter.ts'
import { DeviceActionExecutor } from './executor.ts'
import { loadOrCreateDeviceIdentity } from './identity.ts'
import { MacOSConfirmator } from './macos-confirmator.ts'
import { PlaywrightMcpAdapter } from './playwright-mcp-adapter.ts'
import { LocalPairingHandler } from './pairing.ts'

interface ConnectionState { readonly server: string; readonly deviceId: string }

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index < 0 ? fallback : process.argv[index + 1]
}

async function saveConnection(path: string, state: ConnectionState): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, `${JSON.stringify(state)}\n`, { encoding: 'utf8', mode: 0o600 })
}

async function readConnection(path: string): Promise<ConnectionState | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    return typeof value['server'] === 'string' && typeof value['deviceId'] === 'string'
      ? { server: value['server'], deviceId: value['deviceId'] }
      : undefined
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function main(): Promise<void> {
  const server = option('--server')
  if (server === undefined) throw new Error('usage: dsh-device-agent --server <DSH origin> [--port 47631]')
  const stateRoot = option('--state-dir', join(homedir(), '.dsh', 'device-agent')) as string
  const identity = await loadOrCreateDeviceIdentity(join(stateRoot, 'identity.json'))
  const connectionPath = join(stateRoot, 'connection.json')
  let connection = await readConnection(connectionPath)
  let heartbeatTimer: NodeJS.Timeout | undefined
  let actionTimer: NodeJS.Timeout | undefined
  const startHeartbeat = (state: ConnectionState): void => {
    clearInterval(heartbeatTimer)
    clearInterval(actionTimer)
    const client = new DeviceAgentClient({ ...state, privateKey: identity.privateKey })
    const executor = new DeviceActionExecutor(client, [
      new AgentBrowserAdapter(), new CuaAdapter(import.meta.resolve('@trycua/cua-driver')),
      new PlaywrightMcpAdapter(),
    ], new MacOSConfirmator())
    const heartbeat = (): void => { void client.heartbeat().catch(() => {}) }
    heartbeat()
    heartbeatTimer = setInterval(heartbeat, 15_000)
    let actionPending = false
    const poll = async (): Promise<void> => {
      if (actionPending) return
      actionPending = true
      try {
        const action = await client.claimAction()
        if (action === undefined) return
        const result = await executor.execute(action)
        await client.completeAction({ ...result, runId: action.runId })
      } catch {
        // The next poll resumes the durable queue; a claimed action is never blindly replayed.
      } finally {
        actionPending = false
      }
    }
    actionTimer = setInterval(() => { void poll() }, 1_000)
  }
  if (connection?.server === server) startHeartbeat(connection)
  const handler = new LocalPairingHandler({
    serverOrigin: new URL(server).origin, publicKey: identity.publicKey, deviceName: hostname(),
    platform: platform() === 'darwin' ? 'macos' : platform() === 'win32' ? 'windows' : 'linux',
    challenge: randomUUID().replaceAll('-', ''),
    complete: async (deviceId) => {
      connection = { server, deviceId }
      await saveConnection(connectionPath, connection)
      startHeartbeat(connection)
    },
  })
  const local = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const headers = Object.fromEntries(Object.entries(req.headers).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ))
    const response = await handler.fetch(new Request(`http://127.0.0.1${req.url ?? '/'}`, {
      method: req.method ?? 'GET', headers,
      ...(chunks.length === 0 ? {} : { body: Buffer.concat(chunks) }),
    }))
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    res.end(response.body === null ? undefined : Buffer.from(await response.arrayBuffer()))
  })
  const port = Number(option('--port', '47631'))
  await new Promise<void>((resolve, reject) => {
    local.once('error', reject)
    local.listen(port, '127.0.0.1', resolve)
  })
  console.log(`DSH Device Agent ready at http://127.0.0.1:${String(port)}`)
  const close = (): void => {
    clearInterval(heartbeatTimer)
    clearInterval(actionTimer)
    local.close(() => process.exit(0))
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

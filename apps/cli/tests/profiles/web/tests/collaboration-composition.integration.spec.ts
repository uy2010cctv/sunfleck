/** Keyless source-checkout enterprise Web composition through the supported profile launcher. */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import WebSocket from 'ws'
import { describe, expect, it, type TestContext } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'
import { PROCESS_SHUTDOWN_TIMEOUT_MS } from '../../../../src/process-shutdown.ts'

const databaseUrl = process.env.DSH_TEST_POSTGRES_URL
const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url))
const fixtureRoot = fileURLToPath(new URL('./fixtures/collaboration/', import.meta.url))

interface Ready {
  readonly url: string
  readonly workspaceId: string
  readonly employees: readonly string[]
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected response object')
  return value as Record<string, unknown>
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected response string')
  return value
}

function projections(stream: string): Record<string, unknown> {
  const frames: unknown = JSON.parse(stream)
  if (!Array.isArray(frames)) throw new Error('expected native stream frames')
  for (const frame of frames) {
    const value = record(record(frame)['value'])
    if (value['type'] === 'snapshot') return record(record(value['projections'])['values'])
  }
  throw new Error('native Session stream omitted its opening snapshot')
}

function cookies(response: Response): string[] {
  return response.headers.getSetCookie().map(value => value.split(';')[0]!)
}

async function follow(url: string, cookie: string, sessionId: string, signal: AbortSignal): Promise<string> {
  const socket = new WebSocket(`${url.replace('http:', 'ws:')}/api/remote.mux`, {
    headers: { cookie, origin: url },
  })
  const closed = new Promise<void>((resolve) => { socket.once('close', () => { resolve() }) })
  const response = Promise.withResolvers<string>()
  const frames: unknown[] = []
  const abort = (): void => { response.reject(signal.reason); socket.terminate() }
  signal.addEventListener('abort', abort, { once: true })
  socket.on('error', (error) => { response.reject(error) })
  socket.on('close', () => { response.reject(new Error('native Session stream closed before the completed reply')) })
  socket.on('open', () => {
    socket.send(JSON.stringify({ type: 'open', streamId: 'collaboration', endpoint: 'session/follow',
      payload: { args: { request: { address: { kind: 'session', sessionId }, maxMessages: 40 } } } }))
  })
  socket.on('message', (data) => {
    try {
      const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)
      const frame = record(JSON.parse(bytes.toString('utf8')))
      if (frame['type'] === 'error') throw new Error(JSON.stringify(frame['error']))
      frames.push(frame)
      const output = JSON.stringify(frames)
      if (output.includes('Collaboration fixture completed the request.') && output.includes('turn/end')) {
        response.resolve(output)
      }
    } catch (error) { response.reject(error) }
  })
  try {
    signal.throwIfAborted()
    return await response.promise
  } finally {
    signal.removeEventListener('abort', abort)
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
    else socket.close()
    await closed
  }
}

async function launch(test: TestContext, root: string, connectionString: string, password: string): Promise<{
  ready: Ready
  close: () => Promise<void>
}> {
  const patch = join(root, 'fixture.patch.json')
  const workspaceRoot = join(root, 'workspace')
  await mkdir(workspaceRoot)
  await writeFile(patch, JSON.stringify([{ insert: [{ id: 'collaboration-fixture',
    name: pathToFileURL(join(fixtureRoot, 'fixture.mjs')).href,
    config: { workspaceRoot },
  }] }]))
  const sessionUrl = new URL(connectionString)
  sessionUrl.searchParams.set('options', '-csearch_path=session_v4')
  const invocation = resolveExampleLaunch({
    srcBin: join(repoRoot, 'apps/cli/src/bin.ts'), mode: 'src', sourceImport: 'tsx/esm',
    tsconfigPath: join(repoRoot, 'tsconfig.base.json'),
    configArgs: ['web', '--patch', join(repoRoot, 'apps/cli/config/enterprise.cordis.patch.yml'),
      '--patch', join(fixtureRoot, 'cordis.patch.yml'), '--patch', patch,
      '--host', '127.0.0.1', '--port', '0', '--no-open'],
    env: { NODE_OPTIONS: undefined, NODE_PATH: undefined, TSX_TSCONFIG_PATH: undefined,
      DSH_HOME: join(root, 'home'), DSH_AGENTS_HOME: join(root, 'agent-home'), DSH_TELEMETRY_DISABLED: '1',
      DSH_ENTERPRISE_MASTER_KEY: randomBytes(32).toString('base64'), DSH_ENTERPRISE_ADMIN_PASSWORD: password,
      DSH_ENTERPRISE_ORG_ID: 'collaboration-fixture', DSH_ENTERPRISE_ORG_NAME: 'Collaboration fixture',
      DSH_ENTERPRISE_DATABASE_URL: connectionString, DSH_ENTERPRISE_SESSION_V4_DATABASE_URL: sessionUrl.href,
      DSH_ENTERPRISE_WORKSPACE_ROOT: join(root, 'managed-workspaces'),
      DSH_ENTERPRISE_OIDC: '[]', DSH_ENTERPRISE_SAML: '[]', DSH_ENTERPRISE_LDAP: '[]',
      DSH_ENTERPRISE_SECURE_COOKIES: 'false',
    },
  })
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD/iu.test(key)))
  const child: ChildProcess = spawn(invocation.command, invocation.args, {
    cwd: root, env: { ...environment, ...invocation.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  const readiness = Promise.withResolvers<Ready>()
  const completion = Promise.withResolvers<{ code: number | null; signal: NodeJS.Signals | null }>()
  let stderr = '', exited = false, forced = false
  child.stderr!.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-16000) })
  child.stdout!.setEncoding('utf8').on('data', (chunk: string) => {
    stderr = (stderr + chunk.replace(/token=[^\s]+/gu, 'token=[redacted]')).slice(-16000)
  })
  child.once('error', (error) => { readiness.reject(error) })
  child.once('close', (code, signal) => {
    exited = true
    readiness.reject(new Error(`Web exited before readiness: ${String(code)} ${String(signal)}\n${stderr}`))
    completion.resolve({ code, signal })
  })
  child.on('message', (message: unknown) => {
    try {
      const value = record(message)
      if (value['type'] === 'failed') throw new Error(string(value['error']))
      if (value['type'] !== 'ready') return
      const employees = value['employees']
      if (!Array.isArray(employees)) throw new Error('fixture employee roster missing')
      readiness.resolve({ url: string(value['url']), workspaceId: string(value['workspaceId']),
        employees: employees.map(string) })
    } catch (error) { readiness.reject(error) }
  })
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => closing ??= (async () => {
    const watchdog = setTimeout(() => { if (!exited) { forced = true; child.kill('SIGKILL') } },
      PROCESS_SHUTDOWN_TIMEOUT_MS * 2)
    try {
      if (!exited) {
        if (child.connected) child.send('stop', (error) => { if (error !== null) child.kill('SIGTERM') })
        else child.kill('SIGTERM')
      }
      const result = await completion.promise
      expect(forced, stderr).toBe(false)
      expect(result.signal, stderr).toBeNull()
      expect(result.code, stderr).toBe(0)
    } finally { clearTimeout(watchdog) }
  })()
  const abort = (): void => { readiness.reject(new Error(`Web readiness cancelled: ${stderr}`, { cause: test.signal.reason })); void close().catch(() => undefined) }
  test.signal.addEventListener('abort', abort, { once: true })
  test.onTestFinished(async () => { test.signal.removeEventListener('abort', abort); await close() },
    LOADER_SMOKE_TEST_TIMEOUT_MS)
  try { return { ready: await readiness.promise, close } } catch (error) { await close(); throw error }
}

describe.skipIf(databaseUrl === undefined)('enterprise collaboration source Web composition', () => {
  it('creates group and channel Sessions, delivers once, reopens, and streams their authorized persisted replies',
    async (test) => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-collaboration-composition-'))
      const name = `dsh_collaboration_${randomUUID().replaceAll('-', '')}`
      const admin = new Pool({ connectionString: databaseUrl, max: 1 })
      let created = false
      let database: Pool | undefined
      let app: Awaited<ReturnType<typeof launch>> | undefined
      try {
        // The name is generated here, never derived from the administrator connection URL.
        await admin.query(`CREATE DATABASE "${name}"`)
        created = true
        const isolatedUrl = new URL(databaseUrl!)
        isolatedUrl.pathname = `/${name}`
        isolatedUrl.searchParams.delete('options')
        database = new Pool({ connectionString: isolatedUrl.href, max: 1 })
        await database.query('CREATE SCHEMA session_v4')
        const password = randomBytes(24).toString('base64url')
        app = await launch(test, root, isolatedUrl.href, password)
        const origin = new URL(app.ready.url).origin
        const browser = await fetch(app.ready.url, { redirect: 'manual', signal: test.signal })
        const login = await fetch(`${origin}/auth/login/local`, { method: 'POST', signal: test.signal,
          headers: { 'content-type': 'application/json', origin },
          body: JSON.stringify({ organizationId: 'collaboration-fixture', username: 'admin', password }) })
        expect(login.status).toBe(200)
        const cookie = [...cookies(browser), ...cookies(login)].join('; ')
        const request = async (path: string, body?: object): Promise<Record<string, unknown>> => {
          const response = await fetch(`${origin}/enterprise/surfaces${path}`, {
            method: body === undefined ? 'GET' : 'POST', signal: test.signal,
            headers: { cookie, origin, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          const value: unknown = await response.json()
          expect(response.ok, JSON.stringify(value)).toBe(true)
          return record(value)
        }
        const rpc = async (method: string, input: object): Promise<Record<string, unknown>> => {
          const response = await fetch(`${origin}/api/${method}`, { method: 'POST', signal: test.signal,
            headers: { cookie, origin, 'content-type': 'application/json' },
            body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method, payload: { args: { request: input } } }),
          })
          const result = record(record(await response.json())['result'])
          expect(result['ok'], JSON.stringify(result)).toBe(true)
          return record(result['value'])
        }
        const context = async (sessionId: string): Promise<Record<string, unknown>> => {
          const response = await fetch(`${origin}/enterprise/session-context/${sessionId}`, {
            headers: { cookie }, signal: test.signal,
          })
          expect(response.status).toBe(200)
          return record(await response.json())
        }
        for (const kind of ['groups', 'channels']) {
          const creation = { name: `Fixture ${kind}`, workspaceId: app.ready.workspaceId, idempotencyKey: randomUUID(),
            memberEmployeeIds: app.ready.employees, memberUserIds: [],
            ...(kind === 'channels' ? { topicPolicy: 'thread', respondPolicy: 'mention_duty',
              dutyEmployeeIds: ['fixture-assistant'] } : {}),
          }
          const row = await request(`/${kind}`, creation)
          const id = string(row['id'])
          expect((await request(`/${kind}`, creation))['id']).toBe(id)
          if (kind === 'groups') {
            expect(await request(`/${id}/open`, {})).toMatchObject({ opened: false, reason: 'select-employee' })
            expect(await request(`/${id}/open`, { employeeId: 'fixture-assistant' })).toMatchObject({ opened: true })
          }
          const messageId = randomUUID()
          const message = { text: `Complete ${kind} request.`, messageId, mentionedEmployeeIds: ['fixture-assistant'] }
          const sent = await request(`/${id}/messages`, message)
          expect(sent['delivered']).toBe(true)
          expect(await request(`/${id}/messages`, message)).toEqual(sent)
          const targets = sent['targets']
          if (!Array.isArray(targets)) throw new Error('delivery has no destinations')
          const sessionId = string(record(targets[0])['sessionId'])
          expect(await request(`/${id}/open`, { employeeId: 'fixture-assistant',
            ...(sent['topicId'] === undefined ? {} : { topicId: sent['topicId'] }),
          })).toMatchObject({ opened: true, sessionId })
          expect(record((await request(`/by-session/${sessionId}`))['detail'])['id']).toBe(id)
          const unauthorized = await fetch(`${origin}/enterprise/surfaces/by-session/${sessionId}`, { signal: test.signal })
          expect(unauthorized.status).toBe(401)
          const stream = await follow(origin, cookie, sessionId, test.signal)
          expect(stream).toContain(message.text)
          const values = projections(stream)
          expect(values['agentPreset']).toBe('standard')
          const pinned = record(values['enterpriseEmployeeRelease'])
          expect(pinned).toMatchObject({ employeeId: 'fixture-assistant', releaseVersion: kind === 'groups' ? 1 : 2 })
          expect(record((await context(sessionId))['employee'])).toMatchObject({
            id: 'fixture-assistant', displayName: kind === 'groups' ? 'Assistant' : 'Updated assistant',
            releaseVersion: kind === 'groups' ? 1 : 2,
          })
          if (kind === 'groups') {
            const draft = await rpc('enterpriseEmployee/getDraft', { presetId: 'fixture-assistant' })
            const saved = await rpc('enterpriseEmployee/saveDraft', { presetId: 'fixture-assistant',
              expectedRevision: draft['revision'], idempotencyKey: randomUUID(), visibility: 'organization',
              profile: { name: 'Updated assistant', prompt: 'Use the newly published employee responsibility.' }, bindings: [],
            })
            const released = await rpc('enterpriseEmployee/publish', { presetId: 'fixture-assistant',
              expectedRevision: saved['revision'], idempotencyKey: randomUUID(),
            })
            expect(released['version']).toBe(2)
            expect(released['releaseId']).not.toBe(pinned['releaseId'])
            expect(await request(`/${id}/open`, { employeeId: 'fixture-assistant' })).toMatchObject({ sessionId })
            expect(projections(await follow(origin, cookie, sessionId, test.signal))['enterpriseEmployeeRelease']).toEqual(pinned)
            expect(record((await context(sessionId))['employee'])).toMatchObject({ displayName: 'Assistant', releaseVersion: 1 })
          }
          const store = database
          await expect.poll(async () => {
            const persisted = await store.query<{ event_type: string; event_json: string }>(
              'SELECT event_type,event_json FROM session_v4.dsh_session_events WHERE session_id=$1 ORDER BY seq', [sessionId])
            return {
              userMessages: persisted.rows.filter(event => event.event_type === 'user/message'
                && JSON.stringify(event.event_json).includes(messageId)).length,
              assistant: persisted.rows.some(event => event.event_type === 'assistant/message'),
              completed: persisted.rows.some(event => event.event_type === 'turn/end'),
            }
          }, { timeout: test.task.timeout }).toEqual({ userMessages: 1, assistant: true, completed: true })
        }
      } finally {
        try { await app?.close() } finally {
          try { await database?.end() } finally {
            try { if (created) await admin.query(`DROP DATABASE "${name}"`) } finally {
              try { await admin.end() } finally { await rm(root, { recursive: true, force: true }) }
            }
          }
        }
      }
    }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

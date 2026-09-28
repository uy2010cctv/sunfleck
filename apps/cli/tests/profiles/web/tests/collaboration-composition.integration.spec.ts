/** Keyless source-checkout enterprise Web composition through the supported profile launcher. */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Pool } from 'pg'
import WebSocket from 'ws'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
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

async function launch(test: TestContext, root: string, connectionString: string, password: string, webhookSecret: string): Promise<{
  ready: Ready
  close: () => Promise<void>
  diagnostics: () => string
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
      DSH_ENTERPRISE_SECURE_COOKIES: 'false', DSH_COLLABORATION_GITHUB_SECRET: webhookSecret,
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
  try { return { ready: await readiness.promise, close, diagnostics: () => stderr } } catch (error) { await close(); throw error }
}

describe.skipIf(databaseUrl === undefined)('enterprise collaboration source Web composition', () => {
  it('shares signed human and Bot events, hands off work, approves channel workflows, and revokes access',
    async (test) => {
      const root = await mkdtemp(join(tmpdir(), 'dsh-collaboration-composition-'))
      const name = `dsh_collaboration_${randomUUID().replaceAll('-', '')}`
      const admin = new Pool({ connectionString: databaseUrl, max: 1 })
      let created = false
      let database: Pool | undefined
      let app: Awaited<ReturnType<typeof launch>> | undefined
      let cleaning: Promise<void> | undefined
      const cleanup = (): Promise<void> => cleaning ??= (async () => {
        try { await app?.close() } finally {
          try { await database?.end() } finally {
            try { if (created) await admin.query(`DROP DATABASE "${name}"`) } finally {
              try { await admin.end() } finally { await rm(root, { recursive: true, force: true }) }
            }
          }
        }
      })()
      test.onTestFinished(cleanup, LOADER_SMOKE_TEST_TIMEOUT_MS)
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
        const webhookSecret = randomBytes(32).toString('base64url')
        app = await launch(test, root, isolatedUrl.href, password, webhookSecret)
        const origin = new URL(app.ready.url).origin
        const browser = await fetch(app.ready.url, { redirect: 'manual', signal: test.signal })
        const login = await fetch(`${origin}/auth/login/local`, { method: 'POST', signal: test.signal,
          headers: { 'content-type': 'application/json', origin },
          body: JSON.stringify({ organizationId: 'collaboration-fixture', username: 'admin', password }) })
        expect(login.status).toBe(200)
        const cookie = [...cookies(browser), ...cookies(login)].join('; ')
        const request = async (path: string, body?: object, actorCookie = cookie): Promise<Record<string, unknown>> => {
          const response = await fetch(`${origin}/enterprise/surfaces${path}`, {
            method: body === undefined ? 'GET' : 'POST', signal: test.signal,
            headers: { cookie: actorCookie, origin, 'content-type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          })
          const value: unknown = await response.json()
          expect(response.ok, JSON.stringify(value)).toBe(true)
          return record(value)
        }
        const rpc = async (method: string, input: object, actorCookie = cookie): Promise<Record<string, unknown>> => {
          const response = await fetch(`${origin}/api/${method}`, { method: 'POST', signal: test.signal,
            headers: { cookie: actorCookie, origin, 'content-type': 'application/json' },
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
        const adminRequest = async (method: string, path: string, body: object): Promise<Response> => {
          const response = await fetch(`${origin}${path}`, { method, signal: test.signal,
            headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
          expect(response.ok, `${method} ${path}: ${response.status} ${response.ok ? '' : await response.clone().text()}`).toBe(true)
          return response
        }
        const colleague = record(await (await adminRequest('POST', '/auth/admin/users', {
          id: 'fixture-colleague', username: 'colleague', displayName: 'Colleague', password, roles: ['operator'],
        })).json())
        await adminRequest('PATCH', '/auth/admin/users/fixture-colleague', { departmentIds: ['fixture-team'],
          primaryDepartmentId: 'fixture-team', expectedRevision: colleague['departmentRevision'] })
        const colleagueLogin = await fetch(`${origin}/auth/login/local`, { method: 'POST', signal: test.signal,
          headers: { 'content-type': 'application/json', origin },
          body: JSON.stringify({ organizationId: 'collaboration-fixture', username: 'colleague', password }) })
        expect(colleagueLogin.status).toBe(200)
        const colleagueCookie = [...cookies(browser), ...cookies(colleagueLogin)].join('; ')
        const createdProject = record(await (await adminRequest('POST', '/enterprise/projects', {
          name: 'Q4 fixture project', goal: 'Share one project Workspace',
        })).json())
        const projectId = string(createdProject['id'])
        const projectWorkspaceId = string(createdProject['workspaceId'])
        const link = await database.query<{ project_id: string }>(
          'SELECT project_id FROM enterprise_project_workspace_links WHERE workspace_id=$1', [projectWorkspaceId])
        expect(link.rows).toEqual([{ project_id: projectId }])
        await adminRequest('POST', `/enterprise/projects/${projectId}/members`, {
          principalType: 'user', principalId: 'fixture-colleague',
        })
        const colleagueProject = await fetch(`${origin}/enterprise/projects/${projectId}`, {
          headers: { cookie: colleagueCookie }, signal: test.signal,
        })
        expect(colleagueProject.status).toBe(200)
        const colleagueProjectDetail = record(await colleagueProject.json())
        expect(colleagueProjectDetail).toMatchObject({ workspaceId: projectWorkspaceId })
        expect(colleagueProjectDetail['members'])
          .toEqual(expect.arrayContaining([{ principalType: 'user', principalId: 'fixture-colleague' }]))
        const projectSession = await rpc('session/create', { workspaceId: projectWorkspaceId }, colleagueCookie)
        expect(typeof projectSession['sessionId']).toBe('string')
        const items = (value: Record<string, unknown>): Record<string, unknown>[] => {
          if (!Array.isArray(value['items'])) throw new Error('room page has no event list')
          return value['items'].map(record)
        }
        const assertSignature = (event: Record<string, unknown>): void => {
          const tags = event['tags']
          if (!Array.isArray(tags)) throw new Error('signed event tags missing')
          const signed = { id: string(event['id']), pubkey: string(event['pubkey']), sig: string(event['sig']),
            created_at: Number(event['created_at']), kind: Number(event['kind']), content: string(event['content']),
            tags: tags.map((tag: unknown) => {
              if (!Array.isArray(tag)) throw new Error('signed event tag is not an array')
              return tag.map(string)
            }) }
          expect(verifyEvent(signed)).toBe(true)
        }
        const roomIds: string[] = []
        const gitRooms: string[] = []
        for (const kind of ['groups', 'channels']) {
          const creation = { name: `Fixture ${kind}`, workspaceId: app.ready.workspaceId, idempotencyKey: randomUUID(),
            memberEmployeeIds: app.ready.employees, memberUserIds: ['fixture-colleague'],
            ...(kind === 'channels' ? { topicPolicy: 'thread', respondPolicy: 'mention_duty',
              dutyEmployeeIds: ['fixture-assistant'] } : {}),
          }
          const row = await request(`/${kind}`, creation)
          const id = string(row['id'])
          roomIds.push(id)
          const directoryResponse = await fetch(`${origin}/enterprise/surfaces`, { signal: test.signal,
            headers: { cookie, origin } })
          expect(directoryResponse.status).toBe(200)
          const directory: unknown = await directoryResponse.json()
          if (!Array.isArray(directory)) throw new Error('room directory is not an array')
          expect(directory.map(record).find(entry => entry['id'] === id)).toMatchObject({
            id, workspaceId: app.ready.workspaceId,
          })
          expect((await request(`/${kind}`, creation))['id']).toBe(id)
          if (kind === 'groups') {
            expect(await request(`/${id}/open`, {})).toMatchObject({ opened: false, reason: 'select-employee' })
            expect(await request(`/${id}/open`, { employeeId: 'fixture-assistant' })).toMatchObject({ opened: true })
          }
          const messageId = randomUUID()
          const message = { text: kind === 'groups' ? 'Fixture file delivery request.' : `Complete ${kind} request.`,
            messageId, mentionedEmployeeIds: ['fixture-assistant'] }
          const sent = await request(`/${id}/messages`, message)
          expect(sent['delivered']).toBe(true)
          expect(await request(`/${id}/messages`, message)).toEqual(sent)
          expect(sent['targets']).toEqual([])
          await expect.poll(async () => {
            const response = await fetch(`${origin}/enterprise/surfaces`, { signal: test.signal,
              headers: { cookie, origin } })
            const rows: unknown = await response.json()
            if (!Array.isArray(rows)) throw new Error('room execution directory is not an array')
            const row = record(rows.map(record).find(entry => entry['id'] === id))
            return Array.isArray(row['executionSessionIds']) && row['executionSessionIds'].length > 0
          }, { timeout: test.task.timeout, message: app.diagnostics() }).toBe(true)
          const executionDirectory = await fetch(`${origin}/enterprise/surfaces`, { signal: test.signal,
            headers: { cookie, origin } })
          expect(executionDirectory.status).toBe(200)
          const executionRows: unknown = await executionDirectory.json()
          if (!Array.isArray(executionRows)) throw new Error('room execution directory is not an array')
          const sessionIds = record(executionRows.map(record).find(entry => entry['id'] === id))['executionSessionIds']
          if (!Array.isArray(sessionIds)) throw new Error('room execution directory omitted Session ids')
          const sessionId = string(sessionIds[0])
          expect(record(executionRows.map(record).find(entry => entry['id'] === id))['executionSessionIds'])
            .toContain(sessionId)
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
            const delivery = await database.query<{ data: { files: readonly { path: string }[] } }>(
              "SELECT event_json::jsonb->'data' AS data FROM session_v4.dsh_session_events WHERE session_id=$1 AND event_type='deliverables/presented' ORDER BY seq",
              [sessionId])
            expect(delivery.rows).toHaveLength(1)
            expect(delivery.rows[0]?.data.files).toEqual([{ path: 'room-report.txt', description: 'Shared room report' }])
            expect(await readFile(join(root, 'workspace', 'room-report.txt'), 'utf8')).toBe('Shared fixture report.\n')
            expect(stream).toContain('call present with existing paths')
            const nativeReply = await database.query<{ seq: string }>(
              "SELECT seq FROM session_v4.dsh_session_events WHERE session_id=$1 AND event_type='assistant/message' ORDER BY seq DESC LIMIT 1",
              [sessionId])
            const presentedResponse = await fetch(`${origin}/enterprise/session-context/presented/${sessionId}`, {
              headers: { cookie }, signal: test.signal,
            })
            expect(presentedResponse.status).toBe(200)
            expect(await presentedResponse.json()).toMatchObject({ files: [{ path: 'room-report.txt',
              replySourceSeq: Number(nativeReply.rows[0]?.seq),
            }] })
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
          const rootEvent = record(sent['event'])
          assertSignature(rootEvent)
          const colleagueMessage = { text: `Colleague shared-room ${kind} message.`, messageId: randomUUID(),
            mentionedEmployeeIds: ['fixture-reviewer'],
            ...(kind === 'channels' ? { threadRoot: rootEvent['id'] } : {}),
          }
          const colleagueReceipt = await request(`/${id}/messages`, colleagueMessage, colleagueCookie)
          expect(await request(`/${id}/messages`, colleagueMessage, colleagueCookie)).toEqual(colleagueReceipt)
          const colleagueEvent = record(colleagueReceipt['event'])
          expect(record(colleagueEvent['author'])).toMatchObject({ kind: 'human', id: 'fixture-colleague' })
          expect(colleagueEvent['pubkey']).not.toBe(rootEvent['pubkey'])
          await expect.poll(async () => {
            const page = items(await request(`/${id}/events`, undefined, colleagueCookie))
            return [...new Set(page.map(event => string(record(event['author'])['id'])))].sort()
          }, { timeout: test.task.timeout }).toEqual(['bootstrap-admin', 'fixture-assistant', 'fixture-colleague', 'fixture-reviewer'])
          if (kind === 'channels') {
            await expect.poll(async () => {
              const events = items(await request(`/${id}/events`))
              return events.filter(event => record(event['author'])['kind'] === 'employee'
                && event['content'] === 'Collaboration fixture completed the request.').length
            }, { timeout: test.task.timeout, message: app.diagnostics() }).toBe(2)
          }
          const page = items(await request(`/${id}/events`))
          for (const event of page) { assertSignature(event); expect(event['tags']).toContainEqual(['h', id]) }
          if (kind === 'groups') {
            for (const event of page.filter(value => record(value['author'])['kind'] === 'employee')) {
              expect(event['threadRoot']).toBeUndefined()
              expect(event['tags']).not.toContainEqual(['e', rootEvent['id'], '', 'root'])
            }
          }
          expect(new Set(page.map(event => event['pubkey'])).size).toBe(4)
          expect(page.filter(event => event['id'] === colleagueEvent['id'])).toHaveLength(1)
          const reactionInput = { eventId: colleagueEvent['id'], emoji: '👍', requestId: randomUUID() }
          const reaction = record((await request(`/${id}/reactions`, reactionInput))['event'])
          expect((await request(`/${id}/reactions`, reactionInput))['event']).toEqual(reaction)
          expect(reaction['kind']).toBe(7)
          if (kind === 'groups') expect(reaction['threadRoot']).toBeUndefined()
          assertSignature(reaction)
          expect(items(await request(`/${id}/search?q=${encodeURIComponent(colleagueMessage.text)}`))
            .map(event => event['id'])).toContain(colleagueEvent['id'])
          const resumedPage = items(await request(`/${id}/events?after=${string(rootEvent['sequence'])}`))
          expect(resumedPage.every(event => BigInt(string(event['sequence'])) > BigInt(string(rootEvent['sequence'])))).toBe(true)
          if (kind === 'channels') {
            const thread = items(await request(`/${id}/events?threadRoot=${string(rootEvent['id'])}`))
            expect(thread.some(event => event['id'] === colleagueEvent['id'])).toBe(true)
            const botEvents = page.filter(event => record(event['author'])['kind'] === 'employee')
            expect(botEvents.filter(event => event['content'] === 'Fixture threaded room post.')).toHaveLength(2)
            expect(botEvents.filter(event => event['content'] === 'Tool room_post started.')).toHaveLength(2)
            expect(botEvents.filter(event => event['content'] === 'Tool room_post succeeded.')).toHaveLength(2)
            expect(botEvents.filter(event => event['content'] === 'Collaboration fixture completed the request.')).toHaveLength(2)
            for (const event of botEvents) {
              expect(event['threadRoot']).toBe(rootEvent['id'])
              expect(event['tags']).toContainEqual(['e', rootEvent['id'], '', 'root'])
              expect(thread.map(value => value['id'])).toContain(event['id'])
            }
            expect(record((await request(`/${id}/events?threadRoot=${string(rootEvent['id'])}`))['root'])['id']).toBe(rootEvent['id'])
            const persistedBotEvents = await database.query<{ thread_root: string; event_json: { tags: string[][] } }>(
              'SELECT thread_root,event_json FROM dsh_enterprise_collaboration_events WHERE surface_id=$1 AND author_kind=$2', [id, 'employee'])
            expect(persistedBotEvents.rows).toHaveLength(botEvents.length)
            for (const event of persistedBotEvents.rows) {
              expect(event.thread_root).toBe(rootEvent['id'])
              expect(event.event_json.tags).toContainEqual(['e', rootEvent['id'], '', 'root'])
            }
            const legacyKey = generateSecretKey(), legacyAuthorId = `historical-${randomUUID()}`
            await database.query('INSERT INTO dsh_enterprise_collaboration_actor_keys(org_id,actor_kind,actor_id,pubkey) VALUES($1,$2,$3,$4)',
              ['collaboration-fixture', 'employee', legacyAuthorId, getPublicKey(legacyKey)])
            const historical = ['Historical off-page reply.', 'Historical off-page tool progress.'].map((content, index) =>
              finalizeEvent({ created_at: 1, kind: index === 0 ? 9 : 41000, content,
                tags: [['h', id], ['dsh-source', `${sessionId}:historical-${index}`]] }, legacyKey))
            const unrelated = finalizeEvent({ created_at: 1, kind: 9, content: 'Historical other-topic reply.',
              tags: [['h', id], ['dsh-source', `unrelated-${randomUUID()}:1`]] }, legacyKey)
            for (const [index, event] of [...historical, unrelated].entries()) {
              await database.query(`INSERT INTO dsh_enterprise_collaboration_events
                (org_id,surface_id,event_id,event_json,author_kind,author_id,source_session_id,source_event_cursor)
                VALUES($1,$2,$3,$4,'employee',$5,$6,$7)`, ['collaboration-fixture', id, event.id, JSON.stringify(event),
                legacyAuthorId, index < 2 ? sessionId : 'unrelated-session', `historical-${index}`])
            }
            expect(items(await request(`/${id}/events?limit=1`)).map(event => event['id'])).toEqual([unrelated.id])
            const historicalHumanKey = generateSecretKey(), historicalHumanId = `historical-human-${randomUUID()}`
            await database.query('INSERT INTO dsh_enterprise_collaboration_actor_keys(org_id,actor_kind,actor_id,pubkey) VALUES($1,$2,$3,$4)',
              ['collaboration-fixture', 'human', historicalHumanId, getPublicKey(historicalHumanKey)])
            const oldReaction = finalizeEvent({ created_at: 1, kind: 7, content: '+',
              tags: [['h', id], ['e', historical[0]!.id]] }, historicalHumanKey)
            const unrelatedReaction = finalizeEvent({ created_at: 1, kind: 7, content: '+',
              tags: [['h', id], ['e', unrelated.id]] }, historicalHumanKey)
            for (const event of [oldReaction, unrelatedReaction]) {
              await database.query(`INSERT INTO dsh_enterprise_collaboration_events
                (org_id,surface_id,event_id,event_json,author_kind,author_id)
                VALUES($1,$2,$3,$4,'human',$5)`, ['collaboration-fixture', id, event.id, JSON.stringify(event), historicalHumanId])
            }
            const historicalThread = items(await request(`/${id}/events?threadRoot=${string(rootEvent['id'])}`))
            expect(historicalThread.map(event => event['id'])).not.toContain(unrelated.id)
            expect(historicalThread.map(event => event['id'])).not.toContain(unrelatedReaction.id)
            const newReaction = record((await request(`/${id}/reactions`, { eventId: historical[0]!.id,
              emoji: '👍', requestId: randomUUID() }))['event'])
            expect(newReaction['threadRoot']).toBe(rootEvent['id'])
            expect(newReaction['tags']).toContainEqual(['e', historical[0]!.id])
            expect(newReaction['tags']).toContainEqual(['e', rootEvent['id'], '', 'root'])
            assertSignature(newReaction)
            const storedReaction = await database.query<{ thread_root: string }>(
              'SELECT thread_root FROM dsh_enterprise_collaboration_events WHERE event_id=$1', [newReaction['id']])
            expect(storedReaction.rows[0]?.thread_root).toBe(rootEvent['id'])
            expect(items(await request(`/${id}/events?threadRoot=${string(rootEvent['id'])}`)).map(event => event['id']))
              .toContain(newReaction['id'])
            const otherTopicReaction = record((await request(`/${id}/reactions`, { eventId: unrelated.id,
              emoji: '👍', requestId: randomUUID() }))['event'])
            expect(otherTopicReaction['threadRoot']).toBeUndefined()
            expect(items(await request(`/${id}/events?threadRoot=${string(rootEvent['id'])}`)).map(event => event['id']))
              .not.toContain(otherTopicReaction['id'])
            const historicalReactionView = historicalThread.find(event => event['id'] === oldReaction.id)
            expect(historicalReactionView).toMatchObject({ threadRoot: rootEvent['id'], tags: oldReaction.tags })
            assertSignature(historicalReactionView!)
            for (const event of historical) {
              const presented = historicalThread.find(value => value['id'] === event.id)
              expect(presented).toMatchObject({ threadRoot: rootEvent['id'], content: event.content })
              expect(presented!['tags']).toEqual(event.tags)
              assertSignature(presented!)
            }
            const unchangedHistory = await database.query<{ thread_root: string | null; event_json: unknown }>(
              'SELECT thread_root,event_json FROM dsh_enterprise_collaboration_events WHERE event_id=ANY($1)',
              [[...historical, oldReaction, unrelatedReaction].map(event => event.id)])
            expect(unchangedHistory.rows).toHaveLength(4)
            for (const event of unchangedHistory.rows) {
              expect(event.thread_root).toBeNull()
              expect([...historical, oldReaction, unrelatedReaction].map(value => record(JSON.parse(JSON.stringify(value)))))
                .toContainEqual(event.event_json)
            }
            const yaml = [
              'version: 1', 'name: Fixture approval workflow', 'on:',
              '  - type: message', '    contains: fixture-approval-trigger', 'steps:',
              '  - type: bot_request', '    employeeId: fixture-reviewer', '    prompt: Review the fixture workflow.',
              '  - type: approval_request', '    summary: Approve fixture continuation',
              '  - type: room_post', '    text: Fixture approved continuation.',
            ].join('\n')
            const saved = record(await (await adminRequest('PUT', `/enterprise/channel-workflows/${id}/fixture-review`,
              { yaml, expectedRevision: 0 })).json())
            expect(saved['revision']).toBe(1)
            const definitions = await fetch(`${origin}/enterprise/channel-workflows/${id}`, {
              headers: { cookie: colleagueCookie }, signal: test.signal })
            expect(definitions.status).toBe(200)
            expect(record(await definitions.json())['canManage']).toBe(false)
            await request(`/${id}/messages`, { text: 'fixture-approval-trigger', messageId: randomUUID(), mentionedEmployeeIds: [] })
            await expect.poll(async () => items(await request(`/${id}/events`))
              .some(event => string(event['content']).startsWith('Approval requested:')),
            { timeout: test.task.timeout, message: app.diagnostics() }).toBe(true)
            const workflowPage = items(await request(`/${id}/events`))
            const approvalEvent = workflowPage.find(event => string(event['content']).startsWith('Approval requested:'))
            expect(approvalEvent, app.diagnostics()).toBeDefined()
            const decisionId = /\((channel-workflow-[a-f0-9]+)\)$/u.exec(string(approvalEvent!['content']))?.[1]
            expect(decisionId).toBeDefined()
            for (const event of workflowPage.filter(event => record(event['author'])['kind'] === 'service')) assertSignature(event)
            expect(workflowPage.some(event => event['content'] === 'Fixture approved continuation.')).toBe(false)
            const approval = await rpc('enterpriseOperation/getApproval', { approvalId: decisionId })
            expect(approval).toMatchObject({ state: 'pending', revision: 1 })
            const revised = record(await (await adminRequest('PUT', `/enterprise/channel-workflows/${id}/fixture-review`, {
              yaml: yaml.replace('Fixture approved continuation.', 'Unapproved revision continuation.'), expectedRevision: 1,
            })).json())
            expect(revised['revision']).toBe(2)
            await adminRequest('POST', `/enterprise/channel-workflows/${id}/decisions/${decisionId}`, {
              approved: true, expectedRevision: approval['revision'], idempotencyKey: randomUUID(),
            })
            const completedPage = items(await request(`/${id}/events`))
            const continuation = completedPage.find(event => event['content'] === 'Fixture approved continuation.')
            expect(continuation).toBeDefined()
            expect(completedPage.some(event => event['content'] === 'Unapproved revision continuation.')).toBe(false)
            assertSignature(continuation!)
            expect(record(continuation!['author'])['kind']).toBe('service')
            const gitYaml = [
              'version: 1', 'name: Fixture release notes', 'on:', '  - type: git',
              '    event: tag_pushed', '    source: primary-github', '    repository: fixture/shared-room',
              'steps:', '  - type: bot_request', '    employeeId: fixture-assistant',
              '    prompt: Draft fixture release notes for v1.2.3.',
              '  - type: approval_request', '    summary: Review fixture release notes',
            ].join('\n')
            await adminRequest('PUT', `/enterprise/channel-workflows/${id}/fixture-release`, { yaml: gitYaml, expectedRevision: 0 })
            const body = JSON.stringify({ ref: 'refs/tags/v1.2.3', deleted: false,
              repository: { full_name: 'fixture/shared-room' } })
            const deliveryId = randomUUID()
            const githubRequest = async (signature: string): Promise<Response> => fetch(`${origin}/enterprise/channel-workflows/github`, {
              method: 'POST', signal: test.signal, body,
              headers: { 'content-type': 'application/json', 'x-github-event': 'push',
                'x-github-delivery': deliveryId, 'x-hub-signature-256': signature },
            })
            expect((await githubRequest(`sha256=${'0'.repeat(64)}`)).status).toBe(401)
            expect((await githubRequest(`sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`)).status).toBe(202)
            const durableIngress = await database.query<{ count: string }>(
              "SELECT count(*) FROM dsh_enterprise_collaboration_events WHERE surface_id=$1 AND event_json->>'content'=$2",
              [id, 'Git tag v1.2.3 pushed to fixture/shared-room'])
            expect(durableIngress.rows[0]?.count).toBe('1')
            await expect.poll(async () => {
              const events = items(await request(`/${id}/events`))
              return events.some(event => event['content'] === 'Fixture release notes draft for v1.2.3.')
                && events.some(event => string(event['content']).startsWith('Approval requested: Review fixture release notes'))
            }, { timeout: test.task.timeout }).toBe(true)
            const gitEvents = items(await request(`/${id}/events`))
            const gitIngress = gitEvents.find(event => event['content'] === 'Git tag v1.2.3 pushed to fixture/shared-room')
            expect(gitIngress).toBeDefined()
            assertSignature(gitIngress!)
            const releaseApproval = gitEvents.find(event => string(event['content']).startsWith('Approval requested: Review fixture release notes'))!
            const releaseDecisionId = /\((channel-workflow-[a-f0-9]+)\)$/u.exec(string(releaseApproval['content']))?.[1]
            expect(await rpc('enterpriseOperation/getApproval', { approvalId: releaseDecisionId })).toMatchObject({ state: 'pending' })
            const scheduledYaml = [
              'version: 1', 'name: Fixture scheduled post', 'on:', '  - type: schedule',
              '    scheduleId: fixture-tick', `    at: "${new Date((Number(gitIngress!['created_at']) + 2) * 1000).toISOString()}"`,
              'steps:', '  - type: room_post', '    text: Fixture scheduled continuation.',
            ].join('\n')
            await adminRequest('PUT', `/enterprise/channel-workflows/${id}/fixture-schedule`, { yaml: scheduledYaml, expectedRevision: 0 })
            await expect.poll(async () => items(await request(`/${id}/events`))
              .some(event => event['content'] === 'Fixture scheduled continuation.'), { timeout: test.task.timeout }).toBe(true)
            const scheduled = items(await request(`/${id}/events`)).find(event => event['content'] === 'Fixture scheduled continuation.')!
            assertSignature(scheduled)
            expect(record(scheduled['author'])['kind']).toBe('service')
            expect(Number(scheduled['created_at'])).toBeGreaterThan(Number(gitIngress!['created_at']))
            expect((await githubRequest(`sha256=${createHmac('sha256', webhookSecret).update(body).digest('hex')}`)).status).toBe(202)
            gitRooms.push(id)
          } else {
            await request(`/${id}/messages`, { text: 'Fixture handoff request.', messageId: randomUUID(),
              mentionedEmployeeIds: ['fixture-assistant'] })
            await expect.poll(async () => items(await request(`/${id}/events`)).some(event =>
              event['content'] === 'Tool room_handoff succeeded.' || event['content'] === 'Tool room_handoff failed.'),
            { timeout: test.task.timeout }).toBe(true)
            const terminalToolFact = items(await request(`/${id}/events`)).find(event =>
              event['content'] === 'Tool room_handoff succeeded.' || event['content'] === 'Tool room_handoff failed.')!
            expect(terminalToolFact['content']).toBe('Tool room_handoff succeeded.')
            await expect.poll(async () => items(await request(`/${id}/events`)).filter(event => event['kind'] === 41001).length,
              { timeout: test.task.timeout }).toBe(1)
            const handoff = items(await request(`/${id}/events`)).find(event => event['kind'] === 41001)!
            assertSignature(handoff)
            expect(handoff['tags']).toContainEqual(['target', 'fixture-reviewer'])
            expect(record(handoff['author'])['id']).toBe('fixture-assistant')
            const owner = await database.query<{ owner_id: string }>(
              'SELECT owner_id FROM dsh_enterprise_collaboration_task_owners WHERE surface_id=$1 AND task_id=$2',
              [id, 'fixture-shared-task'])
            expect(owner.rows).toEqual([{ owner_id: 'fixture-reviewer' }])
            const toolFact = terminalToolFact
            expect(toolFact['kind']).toBe(41000)
            assertSignature(toolFact)
            await expect.poll(async () => items(await request(`/${id}/events`)).some(event =>
              record(event['author'])['id'] === 'fixture-reviewer'
              && BigInt(string(event['sequence'])) > BigInt(string(handoff['sequence']))),
            { timeout: test.task.timeout }).toBe(true)
          }
          const store = database
          await expect.poll(async () => {
            const persisted = await store.query<{ event_type: string; rpc_id: string | null }>(
              "SELECT event_type,event_json::jsonb->'data'->'source'->>'rpcId' AS rpc_id FROM session_v4.dsh_session_events WHERE session_id=$1 ORDER BY seq", [sessionId])
            return {
              userMessages: persisted.rows.filter(event => event.event_type === 'user/message'
                && event.rpc_id === string(record(sent['event'])['id'])).length,
              assistant: persisted.rows.some(event => event.event_type === 'assistant/message'),
              completed: persisted.rows.some(event => event.event_type === 'turn/end'),
            }
          }, { timeout: test.task.timeout }).toEqual({ userMessages: 1, assistant: true, completed: true })
        }
        await adminRequest('PATCH', '/auth/admin/users/fixture-colleague', { departmentIds: [], expectedRevision: 1 })
        for (const id of roomIds) {
          const denied = await fetch(`${origin}/enterprise/surfaces/${id}/events`, {
            headers: { cookie: colleagueCookie }, signal: test.signal })
          expect(denied.status).toBe(404)
          const deniedWrite = await fetch(`${origin}/enterprise/surfaces/${id}/messages`, { method: 'POST',
            headers: { cookie: colleagueCookie, origin, 'content-type': 'application/json' }, signal: test.signal,
            body: JSON.stringify({ text: 'Revoked message must not persist.', messageId: randomUUID() }) })
          expect(deniedWrite.status).toBe(404)
          expect(items(await request(`/${id}/events`)).some(event => event['content'] === 'Revoked message must not persist.')).toBe(false)
        }
        await app.close()
        expect(app.diagnostics()).not.toContain('room-event-idempotency-conflict')
        for (const id of gitRooms) {
          const events = await database.query<{ count: string }>(
            "SELECT count(*) FROM dsh_enterprise_collaboration_events WHERE surface_id=$1 AND event_json->>'content'=$2",
            [id, 'Git tag v1.2.3 pushed to fixture/shared-room'])
          expect(events.rows[0]?.count).toBe('1')
          const runs = await database.query<{ count: string }>(
            'SELECT count(*) FROM dsh_enterprise_channel_workflow_runs WHERE surface_id=$1 AND workflow_id=$2',
            [id, 'fixture-release'])
          expect(runs.rows[0]?.count).toBe('1')
        }
      } finally { await cleanup() }
    }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})

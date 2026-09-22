/** Open declared source files verified by the viewed Session's filesystem. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-api-workspace-files'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import {
  basename, isPresentedData, isPresentedFile, PRESENT_DOWNLOAD_PATH, PRESENT_OPEN_PATH, PRESENT_HOST_PATH,
  type PresentedHost,
} from './presented.ts'

const DOWNLOAD_CHUNK_BYTES = 256 * 1024

/**
 * Register native opening inside Connection's authentication fence.
 * @param ctx - Session lookup, native opener, and route lifetime.
 */
export function registerPresentOpen(ctx: Context): void {
  ctx.connection.fetch.register({
    path: PRESENT_HOST_PATH, methods: ['GET'], requestBody: 'buffered',
    fetch: () => Promise.resolve(Response.json(ctx.sessionController.workspaceDesktop() satisfies PresentedHost,
      { headers: { 'cache-control': 'no-store' } })),
  })
  const lifetime = new AbortController()
  const pending = new Set<Promise<Response>>()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled(pending)
  })
  ctx.connection.fetch.register({
    path: PRESENT_OPEN_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => {
      const task = handlePresentOpen(ctx, new Request(request, {
        signal: AbortSignal.any([request.signal, lifetime.signal]),
      }))
      pending.add(task)
      void task.then(() => { pending.delete(task) }, () => { pending.delete(task) })
      return task
    },
  })
  ctx.connection.fetch.register({
    path: PRESENT_DOWNLOAD_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: request => handlePresentDownload(ctx, new Request(request, {
      signal: AbortSignal.any([request.signal, lifetime.signal]),
    })),
  })
}

function coordinates(request: Request): { id: SessionId; seq: SessionSeq; index: number } | undefined {
  const query = new URL(request.url).searchParams
  const id = query.get('sessionId')
  const seq = query.get('seq')
  const index = query.get('index')
  if (!id || seq === null || index === null || !/^\d+$/.test(seq) || !/^\d+$/.test(index)
    || !Number.isSafeInteger(Number(seq)) || !Number.isSafeInteger(Number(index))) return undefined
  return { id: id as SessionId, seq: Number(seq) as SessionSeq, index: Number(index) }
}

function unavailable(error: unknown): Response {
  const remote = remoteErrorOf(error)
  const missing = remote?.code === 'session/not-found' || remote?.code === 'workspace-file/not-found'
    || remote?.code === 'workspace-file/not-regular-file' || error instanceof Error && 'code' in error
    && (error.code === 'SESSION_QUERY_SESSION_NOT_FOUND' || error.code === 'SESSION_QUERY_EVENT_NOT_FOUND'
      || error.code === 'ENOENT' || error.code === 'ENOTDIR')
  return new Response('Presented file unavailable.', { status: missing ? 404 : 500 })
}

async function handlePresentDownload(ctx: Context, request: Request): Promise<Response> {
  const at = coordinates(request)
  if (at === undefined) return new Response('Invalid Presented file coordinates.', { status: 400 })
  try {
    request.signal.throwIfAborted()
    const { target, session } = await ctx.sessionQuery.readEvent({
      sessionId: at.id, seq: at.seq, before: 0, after: 0,
    }, request.signal)
    const file = target.type === 'deliverables/presented' && isPresentedData(target.data)
      ? target.data.files[at.index]
      : undefined
    if (!isPresentedFile(file)) return new Response('Presented file not found in this Session result.', { status: 404 })
    const scope = { sessionId: at.id, workspaceRoot: session.cwd ?? ctx.sandboxPolicy.workspaceRoot }
    const initial = await ctx.workspaceFiles.stat(scope, file.path, request.signal)
    const fsTarget = await ctx.fs.resolve(initial.absolutePath, { signal: request.signal })
    let offset = 0
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          request.signal.throwIfAborted()
          const info = await ctx.fs.stat(fsTarget, request.signal)
          if (info === undefined || info.type !== 'file' || info.version !== initial.version) {
            throw new Error('Presented file changed during download.')
          }
          if (initial.bytes !== undefined && offset >= initial.bytes) {
            controller.close()
            return
          }
          const remaining = initial.bytes === undefined ? DOWNLOAD_CHUNK_BYTES : initial.bytes - offset
          const bytes = await ctx.fs.readByteRange(fsTarget, {
            offset, length: Math.min(DOWNLOAD_CHUNK_BYTES, remaining),
          }, request.signal)
          if (bytes.length === 0) {
            controller.close()
            return
          }
          offset += bytes.length
          controller.enqueue(bytes)
          if (bytes.length < DOWNLOAD_CHUNK_BYTES || initial.bytes !== undefined && offset >= initial.bytes) controller.close()
        } catch (error: unknown) {
          controller.error(error)
        }
      },
    })
    const filename = encodeURIComponent(basename(file.path)).replace(/'/g, '%27')
    return new Response(body, { headers: {
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="download"; filename*=UTF-8''${filename}`,
      'content-type': 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      ...(initial.bytes === undefined ? {} : { 'content-length': String(initial.bytes) }),
    } })
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    return unavailable(error)
  }
}

async function handlePresentOpen(ctx: Context, request: Request): Promise<Response> {
  const query = new URL(request.url).searchParams
  const action = query.get('action') ?? 'open'
  if (action !== 'open' && action !== 'reveal') return new Response('Invalid file action.', { status: 400 })
  const at = coordinates(request)
  if (at === undefined) {
    return new Response('Invalid Presented file coordinates.', { status: 400 })
  }
  try {
    request.signal.throwIfAborted()
    if (!ctx.sessionController.workspaceDesktop().available) return new Response('Host desktop unavailable.', { status: 409 })
    const { target, session } = await ctx.sessionQuery.readEvent({
      sessionId: at.id, seq: at.seq, before: 0, after: 0,
    }, request.signal)
    const file = target.type === 'deliverables/presented' && isPresentedData(target.data) ? target.data.files[at.index] : undefined
    if (!isPresentedFile(file)) return new Response('Presented file not found in this Session result.', { status: 404 })
    request.signal.throwIfAborted()
    const { fs, workspaceFiles } = ctx
    const { absolutePath: path } = await workspaceFiles.stat({
      sessionId: at.id,
      workspaceRoot: session.cwd ?? ctx.sandboxPolicy.workspaceRoot,
    }, file.path, request.signal)
    const mapped = fs.processPathFromHostPath(path)
    if (mapped === undefined || fs.processPath(await fs.resolve(mapped, { signal: request.signal })) !== path) {
      return new Response('Presented file has no verified Host path.', { status: 422 })
    }
    request.signal.throwIfAborted()
    await ctx.sessionController.openWorkspacePath({ path, ...(action === 'reveal' ? { action } : {}) }, request.signal)
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    return unavailable(error)
  }
}

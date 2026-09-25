import { describe, expect, it, vi } from 'vitest'
import { SessionContextController } from '../src/client/session-context-store.ts'
const data = { employee: { id: 'employee-a', displayName: '采购员', role: '采购', capabilities: ['采购查询'] }, memories: [], memoryAvailable: true }
describe('native Session context', () => {
  it('rejects stale responses and clears context immediately on Session change', async () => {
    let resolveFirst: (value: Response) => void = () => {}
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce(new Response(JSON.stringify(data)))
    const controller = new SessionContextController(fetch)
    const first = controller.load('old-session')
    await controller.load('new-session')
    resolveFirst(new Response(JSON.stringify({ ...data, employee: { ...data.employee, displayName: '旧员工' } })))
    await first
    expect(controller.state.getSnapshot().sessionId).toBe('new-session')
    expect(controller.state.getSnapshot().context?.employee?.displayName).toBe('采购员')
    await controller.load(undefined)
    expect(controller.state.getSnapshot().context).toBeNull()
  })
  it('removes previously visible private context immediately during a same-Session authorization refresh', async () => {
    let resolveRefresh: (value: Response) => void = () => {}
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(data)))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRefresh = resolve }))
    const controller = new SessionContextController(fetch)
    await controller.load('current')
    const refreshing = controller.load('current')
    expect(controller.state.getSnapshot().context).toBeNull()
    expect(controller.state.getSnapshot().phase).toBe('loading')
    resolveRefresh(new Response('', { status: 403 }))
    await refreshing
    expect(controller.state.getSnapshot().phase).toBe('unavailable')
    expect(controller.state.getSnapshot().context).toBeNull()
  })
  it('treats denied access as unavailable and malformed responses as errors', async () => {
    const controller = new SessionContextController(vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })).mockResolvedValueOnce(new Response('{}')))
    await controller.load('denied')
    expect(controller.state.getSnapshot().phase).toBe('unavailable')
    await controller.load('malformed')
    expect(controller.state.getSnapshot().phase).toBe('error')
  })
})

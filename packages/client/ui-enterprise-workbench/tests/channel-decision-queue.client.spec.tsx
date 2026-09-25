// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { ChannelDecisionQueue } from '../src/client/ChannelDecisionQueue.tsx'
import { zh, type CollaborationKey } from '../src/client/collaboration-locales.ts'

afterEach(cleanup)
const t: TranslateNS<'enterprise.collaboration'> = key => zh[key as CollaborationKey] ?? key
const pending = { approvalId: 'approval-1', summary: '审核 release notes', state: 'pending', revision: 1, requestedBy: 'editor', createdAt: 1 }

describe('channel decision cards', () => {
  it('shows a pending decision read-only when current policy denies action', async () => {
    const transport = vi.fn(async () => Response.json({ items: [pending], canDecide: false }))
    render(<ChannelDecisionQueue channelId="channel" t={t} transport={transport}/>)
    expect(await screen.findByText('审核 release notes')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull()
    expect(screen.queryByRole('button', { name: '驳回' })).toBeNull()
  })

  it('approves with the expected revision and reports completion only after readback', async () => {
    const bodies: Record<string, unknown>[] = []
    let reads = 0
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>)
        return Response.json({ state: 'approved' })
      }
      return Response.json({ items: ++reads === 1 ? [pending] : [], canDecide: true })
    })
    render(<ChannelDecisionQueue channelId="channel" t={t} transport={transport}/>)
    fireEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(await screen.findByText('决策已记录')).toBeTruthy()
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ approved: true, expectedRevision: 1 })
    expect(typeof bodies[0]?.['idempotencyKey']).toBe('string')
  })

  it('retries an uncertain rejection with the same key and retains the card until readback', async () => {
    const keys: string[] = []
    let posts = 0
    let reads = 0
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as { idempotencyKey: string; approved: boolean }
        keys.push(body.idempotencyKey)
        expect(body.approved).toBe(false)
        if (++posts === 1) throw new Error('connection lost after admission')
        return Response.json({ state: 'rejected' })
      }
      return Response.json({ items: ++reads === 1 ? [pending] : [], canDecide: true })
    })
    render(<ChannelDecisionQueue channelId="channel" t={t} transport={transport}/>)
    fireEvent.click(await screen.findByRole('button', { name: '驳回' }))
    expect(await screen.findByText(/结果尚不确定/)).toBeTruthy()
    expect(screen.getByText('审核 release notes')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试同一决策' }))
    expect(await screen.findByText('决策已记录')).toBeTruthy()
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it('refreshes a conflict and requires a new explicit decision at the new revision', async () => {
    let reads = 0
    const bodies: Record<string, unknown>[] = []
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>
        bodies.push(body)
        return bodies.length === 1 ? new Response('', { status: 409 }) : Response.json({ state: 'rejected' })
      }
      reads += 1
      return Response.json({ items: reads > 2 ? [] : [{ ...pending, revision: reads }], canDecide: true })
    })
    render(<ChannelDecisionQueue channelId="channel" t={t} transport={transport}/>)
    fireEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(await screen.findByText(/决策已变化/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '刷新会话' }))
    await waitFor(() => { expect(screen.getByRole('button', { name: '驳回' })).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '驳回' }))
    expect(await screen.findByText('决策已记录')).toBeTruthy()
    expect(bodies.map(body => body['expectedRevision'])).toEqual([1, 2])
    expect(bodies.map(body => body['approved'])).toEqual([true, false])
  })

  it('retains the pending card but hides actions after a save-time permission loss', async () => {
    const transport = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST'
      ? new Response('', { status: 403 }) : Response.json({ items: [pending], canDecide: true }))
    render(<ChannelDecisionQueue channelId="channel" t={t} transport={transport}/>)
    fireEvent.click(await screen.findByRole('button', { name: '批准' }))
    expect(await screen.findByText('你已无权审批')).toBeTruthy()
    expect(screen.getByText('审核 release notes')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '批准' })).toBeNull()
  })
})

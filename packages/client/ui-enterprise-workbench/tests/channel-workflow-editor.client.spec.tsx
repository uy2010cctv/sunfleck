// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { ChannelWorkflowEditor } from '../src/client/ChannelWorkflowEditor.tsx'
import { zh, type CollaborationKey } from '../src/client/collaboration-locales.ts'

afterEach(cleanup)
const t: TranslateNS<'enterprise.collaboration'> = key => zh[key as CollaborationKey] ?? key
const yaml = 'version: 1\nname: Release\non:\n  - type: git\n    event: tag_pushed\nsteps:\n  - type: approval_request\n    summary: Review release notes\n'
const workflow = { id: 'release-notes', revision: 1, yaml }

describe('channel workflow editor', () => {
  it('shows authorized members the saved YAML without manager controls', async () => {
    const transport = vi.fn(async () => Response.json({ items: [workflow], canManage: false }))
    render(<ChannelWorkflowEditor channelId="channel" t={t} transport={transport}/>)
    await screen.findByText('版本 1')
    expect(document.querySelector('pre')?.textContent).toBe(yaml)
    expect(screen.queryByRole('textbox', { name: 'YAML 定义' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存版本' })).toBeNull()
  })

  it('saves a manager draft with the exact revision and keeps it after conflict until explicit reload', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    let reads = 0
    let writes = 0
    const transport = vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, ...(init === undefined ? {} : { init }) })
      if (init?.method === 'PUT') {
        writes += 1
        if (writes === 1) return new Response('', { status: 409 })
        return Response.json({ ...workflow, revision: 3, yaml: `${yaml}# edited\n` })
      }
      reads += 1
      return Response.json({ items: [{ ...workflow, revision: reads === 1 ? 1 : 2 }], canManage: true })
    })
    render(<ChannelWorkflowEditor channelId="channel" t={t} transport={transport}/>)
    const editor = await screen.findByRole('textbox', { name: 'YAML 定义' })
    if (!(editor instanceof HTMLTextAreaElement)) throw new Error('workflow editor is not a textarea')
    fireEvent.change(editor, { target: { value: `${yaml}# edited\n` } })
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    expect((await screen.findByRole('alert')).textContent).toContain('服务器已有更新版本')
    expect(editor.value).toBe(`${yaml}# edited\n`)
    fireEvent.click(screen.getByRole('button', { name: '读取当前版本' }))
    await screen.findByText('版本 2')
    expect(editor.value).toBe(`${yaml}# edited\n`)
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    await waitFor(() => { expect(screen.getByText('版本 3')).toBeTruthy() })
    const saves = requests.filter(item => item.init?.method === 'PUT')
    expect(saves.map(item => JSON.parse(typeof item.init?.body === 'string' ? item.init.body : '') as { expectedRevision: number }))
      .toEqual([{ yaml: `${yaml}# edited\n`, expectedRevision: 1 }, { yaml: `${yaml}# edited\n`, expectedRevision: 2 }])
    expect(saves[0]?.url).toBe('/enterprise/channel-workflows/channel/release-notes')
  })

  it('creates an explicitly named workflow with expected revision zero and retains invalid YAML', async () => {
    const bodies: Record<string, unknown>[] = []
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>)
        return new Response('', { status: 400 })
      }
      return Response.json({ items: [], canManage: true })
    })
    render(<ChannelWorkflowEditor channelId="channel" t={t} transport={transport}/>)
    await screen.findByText('尚无工作流')
    fireEvent.change(screen.getByRole('textbox', { name: '新工作流 ID' }), { target: { value: 'nightly-release' } })
    fireEvent.click(screen.getByRole('button', { name: '新建工作流' }))
    const editor = screen.getByRole('textbox', { name: 'YAML 定义' })
    if (!(editor instanceof HTMLTextAreaElement)) throw new Error('workflow editor is not a textarea')
    fireEvent.change(editor, { target: { value: yaml } })
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    expect((await screen.findByRole('alert')).textContent).toContain('请检查 YAML')
    expect(editor.value).toBe(yaml)
    expect(bodies).toEqual([{ yaml, expectedRevision: 0 }])
  })

  it('keeps the saved list and unsaved draft visible when a conflict reload fails', async () => {
    let reads = 0
    const transport = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return new Response('', { status: 409 })
      if (++reads > 1) return new Response('', { status: 500 })
      return Response.json({ items: [workflow], canManage: true })
    })
    render(<ChannelWorkflowEditor channelId="channel" t={t} transport={transport}/>)
    const editor = await screen.findByRole('textbox', { name: 'YAML 定义' })
    if (!(editor instanceof HTMLTextAreaElement)) throw new Error('workflow editor is not a textarea')
    fireEvent.change(editor, { target: { value: `${yaml}# changed\n` } })
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    await screen.findByText('读取当前版本')
    fireEvent.click(screen.getByRole('button', { name: '读取当前版本' }))
    await waitFor(() => { expect(screen.getAllByRole('alert').some(item => item.textContent?.includes('工作流加载失败'))).toBe(true) })
    expect(editor.value).toBe(`${yaml}# changed\n`)
    expect(screen.getByText('版本 1')).toBeTruthy()
  })

  it('switches to read-only when manager permission is revoked during save', async () => {
    const transport = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT'
      ? new Response('', { status: 403 }) : Response.json({ items: [workflow], canManage: true }))
    render(<ChannelWorkflowEditor channelId="channel" t={t} transport={transport}/>)
    const editor = await screen.findByRole('textbox', { name: 'YAML 定义' })
    fireEvent.change(editor, { target: { value: `${yaml}# edited\n` } })
    fireEvent.click(screen.getByRole('button', { name: '保存版本' }))
    expect((await screen.findByRole('alert')).textContent).toContain('无权编辑')
    expect(screen.queryByRole('button', { name: '保存版本' })).toBeNull()
    expect(document.querySelector('pre')?.textContent).toBe(yaml)
  })
})

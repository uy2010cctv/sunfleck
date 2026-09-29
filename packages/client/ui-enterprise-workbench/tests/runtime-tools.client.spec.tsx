// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SessionCapabilitiesValue } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { RuntimeToolsPane, type RuntimeToolsPaneProps } from '../src/client/RuntimeToolsPane.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const a = SessionId('scope-a'), b = SessionId('scope-b')
const catalog: SessionListState = { phase: 'ready', ids: [a,b], byId: {
  [a]: { id:a,displayTitle:'采购调研',running:false,blank:false,updatedAt:2,retainedBy:{ mainView:1 } },
  [b]: { id:b,displayTitle:'代码审查',running:false,blank:false,updatedAt:1,retainedBy:{} },
}, projectionsBySession:{} }
const payload: SessionCapabilitiesValue = { sessionId:a,live:true,catalogAt:10,tools:[
  { name:'read',description:'Read files',availability:'registered',calls:4,lastUsedAt:10 },
  { name:'mcp__opaque',description:'Search records',availability:'registered',calls:2,lastUsedAt:9,integration:{ kind:'mcp',name:'server__name',rawName:'search/records' } },
  { name:'delegate',description:'Delegate work',availability:'registered',calls:1,lastUsedAt:8,integration:{ kind:'subagent',name:'external-codex',protocol:'acp' } },
] }
const props = (read: RuntimeToolsPaneProps['read'] = vi.fn(async()=>payload)) => ({
  enabled:true, useSessions:<S,>(select:(value:SessionListState)=>S)=>select(catalog), read,
  openRecord:vi.fn(), onCountChange:vi.fn(), t:makeTranslate(zh),
})

it('shows real runtime names, exact connection identity and calls without creating an asset', async()=>{
  const p=props();render(<RuntimeToolsPane {...p}/>)
  expect(await screen.findByText('server__name')).toBeTruthy()
  expect(screen.getByText('external-codex')).toBeTruthy()
  expect(screen.getByText('read')).toBeTruthy()
  expect(p.onCountChange).toHaveBeenLastCalledWith(3)
  fireEvent.click(screen.getByRole('button',{ name:'MCP' }))
  expect(screen.queryByText('read')).toBeNull()
  expect(screen.getByText('mcp__opaque')).toBeTruthy()
  expect(screen.getAllByRole('article').map(row=>({ name:row.querySelector('strong')?.textContent,labels:[...row.querySelectorAll('span')].map(span=>span.textContent) }))).toMatchSnapshot('MCP runtime identity and attempts')
  fireEvent.click(screen.getByRole('button',{ name:'查看执行记录' }))
  expect(p.openRecord).toHaveBeenCalledWith(a)
})

it('keeps cold history distinct from current registrations',async()=>{
  render(<RuntimeToolsPane {...props(vi.fn(async()=>({ ...payload,live:false,tools:[{ name:'bash',description:'',availability:'observed' as const,calls:5,lastUsedAt:10 }] })))}/>)
  expect(await screen.findByText('bash')).toBeTruthy()
  expect(screen.getByText('历史调用')).toBeTruthy()
  expect(screen.getAllByText('来源未记录')).toHaveLength(2)
})

it('does not read runtime data until the tools category is opened',()=>{
  const p=props();render(<RuntimeToolsPane {...p} enabled={false}/>);expect(p.read).not.toHaveBeenCalled()
})

it('shows a recoverable query failure and retries without inventing an empty inventory',async()=>{
  const p=props(vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(payload));render(<RuntimeToolsPane {...p}/>)
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByText('read')).toBeNull()
  fireEvent.click(screen.getByRole('button',{ name:'重试' }))
  expect(await screen.findByText('read')).toBeTruthy()
})

it('aborts a previous scope read and ignores its late result',async()=>{
  let resolveA!:(value:SessionCapabilitiesValue)=>void
  const read=vi.fn((id:typeof a)=>id===a
    ?new Promise<SessionCapabilitiesValue>((resolve)=>{resolveA=resolve})
    :Promise.resolve({ ...payload,sessionId:b,tools:[] }))
  const p=props(read);render(<RuntimeToolsPane {...p}/>)
  await waitFor(()=>{ expect(read).toHaveBeenCalledOnce() })
  fireEvent.change(screen.getByRole('combobox',{ name:'来源会话' }),{ target:{ value:b } })
  await waitFor(()=>{ expect(read).toHaveBeenCalledTimes(2) })
  await act(async()=>{resolveA(payload)})
  expect(screen.queryByText('server__name')).toBeNull()
})

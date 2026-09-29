/** Authorized Session-scoped runtime tools alongside separately managed assets. */
import { useEffect, useState } from 'react'
import type { SessionCapabilitiesValue, SessionCapabilityTool } from '@deepseek-ai/dsh-api-session-controller/types'
import type { UseSessions } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, IconLoadingOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import css from './RuntimeToolsPane.module.css'

type Translate = (key: EnterpriseWorkbenchKey, params?: Record<string,string|number>)=>string
type Kind = 'native'|'mcp'|'acp'|'delegate'|'unknown'

function toolKind(tool: SessionCapabilityTool): Kind {
  if (tool.integration?.kind === 'mcp') return 'mcp'
  if (tool.integration?.kind === 'subagent') return tool.integration.protocol === 'acp' ? 'acp' : 'delegate'
  return tool.availability === 'registered' ? 'native' : 'unknown'
}

/** Inputs contain only authorized catalog rows and a cancellable inventory read. */
export interface RuntimeToolsPaneProps {
  readonly enabled: boolean
  readonly useSessions: UseSessions
  readonly read: (sessionId:SessionId, signal?:AbortSignal)=>Promise<SessionCapabilitiesValue>
  readonly openRecord: (sessionId:SessionId)=>void
  readonly onCountChange: (count:number|null)=>void
  readonly t: Translate
}

/**
 * Show live registrations or recorded attempts without activating an Agent.
 * @param props - source selection, authorized reader and localized UI actions.
 * @returns source-scoped inventory with explicit loading, failure and empty states.
 */
export function RuntimeToolsPane({ enabled,useSessions,read,openRecord,onCountChange,t }:RuntimeToolsPaneProps) {
  const sessions=useSessions(value=>value)
  const choices=sessions.ids.flatMap(id=>sessions.byId[id]?.blank===false?[sessions.byId[id]]:[])
    .sort((left,right)=>right.updatedAt-left.updatedAt)
  const [chosen,setChosen]=useState<SessionId>()
  const selectedId=choices.find(row=>row.id===chosen)?.id
    ?? choices.find(row=>(row.retainedBy.mainView??0)>0)?.id ?? choices[0]?.id
  const [data,setData]=useState<SessionCapabilitiesValue>()
  const [phase,setPhase]=useState<'loading'|'ready'|'error'>('loading')
  const [version,setVersion]=useState(0)
  const [query,setQuery]=useState('')
  const [kind,setKind]=useState<Kind|'all'>('all')
  useEffect(()=>{
    if (!enabled) return
    if (sessions.phase!=='ready' || selectedId===undefined) {
      setData(undefined);onCountChange(sessions.phase==='ready'?0:null);return
    }
    const abort=new AbortController()
    setPhase('loading');setData(undefined);onCountChange(null)
    void read(selectedId,abort.signal).then((value)=>{
      if (abort.signal.aborted) return
      setData(value);setPhase('ready');onCountChange(value.tools.length)
    }).catch(()=>{
      if (abort.signal.aborted) return
      // A failed read may indicate revoked access; prior metadata is not retained.
      setData(undefined);setPhase('error');onCountChange(null)
    })
    return ()=>{abort.abort()}
  },[enabled,selectedId,sessions.phase,version,read,onCountChange])
  if (!enabled) return null
  const current=data?.sessionId===selectedId && sessions.phase==='ready'?data:undefined
  const tools=(current?.tools??[]).filter(tool=>(kind==='all'||toolKind(tool)===kind)
    && `${tool.name} ${tool.description} ${tool.integration?.name??''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((left,right)=>right.calls-left.calls||left.name.localeCompare(right.name))
  const keys: Readonly<Record<Kind | 'all', EnterpriseWorkbenchKey>> = {
    all: 'runtimeTools.all', native: 'runtimeTools.native', mcp: 'runtimeTools.mcp',
    acp: 'runtimeTools.acp', delegate: 'runtimeTools.delegate', unknown: 'runtimeTools.unknown',
  }
  const availability: Readonly<Record<SessionCapabilityTool['availability'], EnterpriseWorkbenchKey>> = {
    registered: 'runtimeTools.registered', 'last-request': 'runtimeTools.lastRequest', observed: 'runtimeTools.observed',
  }
  const reload = (): void => { setVersion(value => value + 1) }
  const loading = sessions.phase !== 'ready' || selectedId !== undefined && phase === 'loading'
  return <section className={css.root} aria-label={t('runtimeTools.title')}>
    <div className={css.heading}>
      <div><h3>{t('runtimeTools.title')}</h3><p>{t('runtimeTools.intro')}</p></div>
      <Button variant="outline" disabled={selectedId === undefined || phase === 'loading'} onClick={reload}>
        <IconRefreshOutlineRegular size={14}/>{t('runtimeTools.refresh')}
      </Button>
    </div>
    <div className={css.controls}>
      <label>{t('runtimeTools.source')}
        <select value={selectedId ?? ''} disabled={choices.length === 0} onChange={(event) => {
          const id = choices.find(row => row.id === event.target.value)?.id
          if (id !== undefined) { setChosen(id); setQuery(''); setKind('all') }
        }}>
          {choices.length === 0 && <option value="">{t('runtimeTools.noSources')}</option>}
          {choices.map(row => <option value={row.id} key={row.id}>{row.displayTitle}</option>)}
        </select>
      </label>
      <label className={css.search}>
        <span className={css.srOnly}>{t('runtimeTools.search')}</span>
        <input value={query} onChange={(event) => { setQuery(event.target.value) }} placeholder={t('runtimeTools.search')}/>
      </label>
      {selectedId !== undefined && <Button variant="outline" onClick={() => { openRecord(selectedId) }}>
        {t('runtimeTools.openRecord')}
      </Button>}
    </div>
    {loading
      ? <div className={css.boundary}><IconLoadingOutlineRegular size={20}/></div>
      : selectedId === undefined
        ? <p className={css.note}>{t('runtimeTools.noSourcesHelp')}</p>
        : phase === 'error'
          ? <div className={css.boundary} role="alert">
            <p>{t('runtimeTools.failed')}</p><Button variant="outline" onClick={reload}>{t('retry')}</Button>
          </div>
          : <>
            <p className={css.note}>{t(current?.live === true ? 'runtimeTools.liveHelp' : 'runtimeTools.historyHelp')}</p>
            <div className={css.filters} role="group" aria-label={t('runtimeTools.filter')}>
              {(['all', 'native', 'mcp', 'acp', 'delegate', 'unknown'] as const).map(value =>
                <button type="button" aria-pressed={kind === value} key={value} onClick={() => { setKind(value) }}>
                  {t(keys[value])}
                </button>)}
            </div>
            {tools.length === 0
              ? <p className={css.note}>{t(current?.tools.length === 0 ? 'runtimeTools.empty' : 'runtimeTools.noMatches')}</p>
              : <div className={css.list}>{tools.map(tool => <article className={css.row} key={tool.name}>
                <div className={css.identity}>
                  <div className={css.name}>
                    <strong>{tool.name}</strong><span className={css.tag}>{t(keys[toolKind(tool)])}</span>
                  </div>
                  {tool.integration !== undefined && <span className={css.source}>
                    {tool.integration.name}
                    {tool.integration.kind === 'mcp' && tool.integration.rawName !== undefined &&
                      <span> · {tool.integration.rawName}</span>}
                  </span>}
                  {tool.description !== '' && <details>
                    <summary>{t('runtimeTools.description')}</summary><p className={css.description}>{tool.description}</p>
                  </details>}
                </div>
                <div className={css.facts}>
                  <span>{t(availability[tool.availability])}</span><span>{t('runtimeTools.calls', { count: tool.calls })}</span>
                  {tool.lastUsedAt !== null && <time dateTime={new Date(tool.lastUsedAt).toISOString()}>
                    {new Date(tool.lastUsedAt).toLocaleString()}
                  </time>}
                </div>
              </article>)}</div>}
          </>}
  </section>
}

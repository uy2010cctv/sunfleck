/** Root navigation and retained Session detail content in the right column. */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SidebarSessionViewSnapshot } from '../session-views.ts'
import type { SidebarRightNavigationDefinition } from '../navigation-registry.ts'
import { IconBrowseOutlineRegular, IconPanelLeftOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '../contract/slots.ts'
import css from './SidebarRight.module.css'

/** Root-only views, navigation tabs, and frame presentation. */
export interface RightbarRootInjected {
  readonly hooks: {
    readonly views: HostObservable<readonly SidebarSessionViewSnapshot[]>
    readonly navigationTabs: HostObservable<readonly SidebarRightNavigationDefinition[]>
  }
  readonly mountView: (reference: SessionReference) => () => void
  readonly syncNavigationPresentation: (presentation: { shown: boolean; track: boolean; fullscreen: boolean }) => void
  readonly reportNavigationOcclusion: (value: boolean) => void
}

type RootProps = PropsRuntime<'rightbar'>
  & PropsRenderSlots<'rightbar.session' | 'sidebar.right.navigation.tab'>
  & PropsLocale<'sidebarRight'>
  & InjectFace<RightbarRootInjected>

function SessionView({ view, visible, SessionProvider, renderSlot, mountView, width, viewportWidth, canShow }:
  Pick<RootProps, 'SessionProvider' | 'renderSlot' | 'mountView' | 'width' | 'viewportWidth' | 'canShow'>
  & { readonly view: SidebarSessionViewSnapshot; readonly visible: boolean }): ReactNode {
  useLayoutEffect(() => mountView(view.reference), [mountView, view.reference])
  const active = visible && view.selected
  return <div className={css.session} hidden={!active} data-sidebar-right-session={view.sessionId}>
    <SessionProvider session={view.reference}>
      {renderSlot('rightbar.session', { width, viewportWidth, canShow, active, retainTab: view.retainTab })}
    </SessionProvider>
  </div>
}

function Attention({ source }: { readonly source: HostObservable<boolean> }): ReactNode {
  const shown = useSyncExternalStore(source.subscribe, source.getSnapshot)
  return shown ? <span className={css.attention} aria-hidden="true" /> : null
}

/** Root destinations stay available when no Session is selected. */
export function RightbarRoot({
  usePanelInfo, useViews, useNavigationTabs, syncNavigationPresentation, reportNavigationOcclusion, t, ...props
}: RootProps): ReactNode {
  const mainPanelActive = usePanelInfo(info => info.activePanelId !== null)
  const views = useViews(value => value)
  const tabs = useNavigationTabs(value => value)
  const selectedSession = views.find(view => view.selected)?.sessionId
  const [selected, setSelected] = useState<string>(() => selectedSession === undefined ? '' : 'session')
  const narrow = props.viewportWidth < 768
  const [narrowOpen, setNarrowOpen] = useState(() => !mainPanelActive && selectedSession === undefined)
  useEffect(() => {
    if (selectedSession !== undefined) setSelected('session')
    if (narrow && selectedSession !== undefined) setNarrowOpen(false)
  }, [selectedSession, narrow])
  useEffect(() => { if (narrow && mainPanelActive) setNarrowOpen(false) }, [mainPanelActive, narrow])
  const active = selected === 'session' && selectedSession !== undefined && !mainPanelActive ? 'session' : tabs.some(tab => tab.id === selected) ? selected : tabs[0]?.id
  const navigationOpen = !narrow || narrowOpen
  const navigationActive = navigationOpen && active !== undefined && active !== 'session'
  const occludesMain = narrow && navigationActive
  useLayoutEffect(() => {
    reportNavigationOcclusion(occludesMain)
    return () => { reportNavigationOcclusion(false) }
  }, [occludesMain, reportNavigationOcclusion])
  useLayoutEffect(() => {
    syncNavigationPresentation({
      shown: tabs.length > 0 && navigationOpen,
      track: tabs.length > 0 && !narrow,
      fullscreen: tabs.length > 0 && narrow && navigationOpen,
    })
    return () => { syncNavigationPresentation({ shown: false, track: false, fullscreen: false }) }
  }, [tabs.length, narrow, navigationOpen, syncNavigationPresentation])
  const ids = [...tabs.map(tab => tab.id), ...(selectedSession === undefined ? [] : ['session'])]
  const chooseAdjacent = (id: string, direction: number): void => {
    const index = ids.indexOf(id)
    if (index < 0 || ids.length === 0) return
    const next = ids[(index + direction + ids.length) % ids.length]
    if (next === undefined) return
    setSelected(next)
    document.querySelector<HTMLButtonElement>(`[data-right-navigation-tab="${next}"]`)?.focus()
  }
  return <>
    {narrow && !narrowOpen && tabs.length > 0 && <Tooltip label={t('navigation.reopen')} side="bottom">
      <button type="button" className={css.navigationReopen} aria-label={t('navigation.reopen')}
        onClick={() => { setNarrowOpen(true) }}><IconPanelLeftOutlineRegular size={18}/></button>
    </Tooltip>}
    {navigationOpen && ids.length > 0 && <div className={css.navigation} style={{ width: narrow ? '100vw' : props.width }} data-right-navigation data-right-navigation-fullscreen={narrow || undefined}>
      <div className={css.navigationTabs} role="tablist" aria-label={t('navigation.label')}>
        {tabs.map(tab => <button key={tab.id} type="button" role="tab" data-right-navigation-tab={tab.id}
          aria-selected={active === tab.id} aria-controls="right-navigation-content" tabIndex={active === tab.id ? 0 : -1}
          onClick={() => { setSelected(tab.id) }} onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); chooseAdjacent(tab.id, 1) }
            if (event.key === 'ArrowLeft') { event.preventDefault(); chooseAdjacent(tab.id, -1) }
          }}>
          <span aria-hidden="true"><tab.icon size={16}/></span><span>{tab.title()}</span>{tab.attention !== undefined && <Attention source={tab.attention} />}
        </button>)}
        {selectedSession !== undefined && <button type="button" role="tab" data-right-navigation-tab="session"
          aria-selected={active === 'session'} tabIndex={active === 'session' ? 0 : -1}
          onClick={() => { setSelected('session') }} onKeyDown={(event) => {
            if (event.key === 'ArrowRight') { event.preventDefault(); chooseAdjacent('session', 1) }
            if (event.key === 'ArrowLeft') { event.preventDefault(); chooseAdjacent('session', -1) }
          }}><span aria-hidden="true"><IconBrowseOutlineRegular size={16}/></span>{t('navigation.session')}</button>}
        {narrow && <Tooltip label={t('navigation.close')} side="bottom"><button type="button" className={css.navigationClose}
          aria-label={t('navigation.close')} onClick={() => { setNarrowOpen(false) }}><IconPanelLeftOutlineRegular size={16}/></button></Tooltip>}
      </div>
      {navigationActive && <div id="right-navigation-content" role="tabpanel" className={css.navigationContent}>
        {props.renderSlot('sidebar.right.navigation.tab', { wide: true, expandSidebar: () => {}, closeNavigation: () => { setNarrowOpen(false) } }, { entryKey: active })}
      </div>}
    </div>}
    {views.map(view => <SessionView key={view.sessionId} {...props} view={view} visible={!mainPanelActive && active === 'session'} />)}
  </>
}

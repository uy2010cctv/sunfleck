/** Selection and retention policy for independently owned Sidebar Session views. */
import type { ISessions, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SidebarSessionView } from './session-view.ts'

/** The reference is exclusively a framework SessionProvider target, not a business-component service. */
export interface SidebarSessionViewSnapshot {
  readonly sessionId: SessionId
  readonly reference: SessionReference
  readonly selected: boolean
  /** Global panel hosting an explicit preview; absent for ordinary Session views. */
  readonly previewPanelId?: MainPanelId
  /** Stable for this View's lifetime, independently of Session injection bindings. */
  readonly retainTab: SidebarSessionView['retainTab']
}

/** Selects and retires views; the Sidebar plugin's injected dependencies own global teardown. */
export class SidebarSessionViews {
  /** Selected and retained View targets observed by the root renderer. */
  readonly source = createSnapshotStore<readonly SidebarSessionViewSnapshot[]>([])
  private readonly views = new Map<SessionId, SidebarSessionView>()
  private readonly viewsByReference = new Map<SessionReference, SidebarSessionView>()
  private selected: SessionId | undefined
  private preview: { sessionId: SessionId; panelId: MainPanelId } | undefined
  private closed = false

  constructor(private readonly sessions: ISessions) {}

  /**
   * Change the foreground Session while preserving retained background Views.
   * @param sessionId - main selection, or absence.
   */
  select(sessionId: SessionId | undefined): void {
    if (this.closed || this.selected === sessionId) return
    this.selected = sessionId
    if (sessionId !== undefined) this.ensure(sessionId)
    for (const view of this.views.values()) this.prune(view)
    this.publish()
  }

  /**
   * Display source Session content alongside a global panel, preserving main selection.
   * @param sessionId - source Session whose Sidebar should render.
   * @param panelId - central panel retaining ownership of the preview.
   */
  showPreview(sessionId: SessionId, panelId: MainPanelId): void {
    if (this.closed) return
    this.ensure(sessionId)
    this.preview = { sessionId, panelId }
    for (const view of this.views.values()) this.prune(view)
    this.publish()
  }

  /** Withdraw a preview and release its unretained source after committed roots unmount. */
  clearPreview(): void {
    if (this.preview === undefined) return
    this.preview = undefined
    for (const view of this.views.values()) this.prune(view)
    this.publish()
  }

  /**
   * Withdraw a preview when its central panel changes.
   * @param panelId - newly selected central panel.
   * @returns whether an explicit preview was withdrawn.
   */
  changePanel(panelId: MainPanelId | null): boolean {
    if (this.preview === undefined || this.preview.panelId === panelId) return false
    this.clearPreview()
    return true
  }

  private ensure(sessionId: SessionId): void {
    if (this.views.has(sessionId)) return
    const view = new SidebarSessionView(sessionId, this.sessions, (disposed) => {
      this.viewsByReference.delete(disposed.reference)
    }, (released) => { this.prune(released) })
    this.views.set(sessionId, view)
    this.viewsByReference.set(view.reference, view)
  }

  /**
   * Bind a committed root; release retired references after that root unmounts.
   * @param reference - framework target published by this owner.
   * @returns releases this committed mount.
   */
  mount(reference: SessionReference): () => void {
    const view = this.viewsByReference.get(reference)
    if (view === undefined) {
      if (this.closed) return () => {}
      throw new Error('Sidebar Session view reference is no longer owned')
    }
    return view.mount()
  }

  /** Plugin shutdown releases every view, including any awaiting a React unmount. */
  dispose(): void {
    this.closed = true
    this.views.clear()
    this.source.set([])
    for (const view of this.viewsByReference.values()) view.dispose()
  }

  private prune(view: SidebarSessionView): void {
    if (view.sessionId === this.selected || view.sessionId === this.preview?.sessionId
      || view.hasRetainedTabs || this.views.get(view.sessionId) !== view) return
    this.views.delete(view.sessionId)
    // Render targets must be withdrawn before an unmounted view can release its reference.
    this.publish()
    view.retire()
  }

  private publish(): void {
    this.source.set([...this.views.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId)).map(view => ({
      sessionId: view.sessionId, reference: view.reference,
      selected: view.sessionId === (this.preview?.sessionId ?? this.selected), retainTab: view.retainTab,
      ...(view.sessionId === this.preview?.sessionId ? { previewPanelId: this.preview.panelId } : {}),
    })))
  }
}

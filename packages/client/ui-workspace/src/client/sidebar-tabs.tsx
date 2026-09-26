/** Workspace, group, and channel browsing in the native left sidebar. */
import { useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './SidebarTabs.module.css'

/** One left-sidebar destination and its category-level attention. */
export interface SidebarTabDefinition {
  readonly id: string
  readonly order: number
  readonly title: () => string
  readonly icon: ComponentType<IconProps>
  readonly attention?: HostObservable<boolean>
}

/** Root registry used by Workspace and enterprise collaboration contributors. */
export class SidebarTabRegistry {
  private readonly definitions = new Map<string, SidebarTabDefinition>()
  private readonly snapshot = createSnapshotStore<readonly SidebarTabDefinition[]>([])
  readonly source: HostObservable<readonly SidebarTabDefinition[]> = this.snapshot

  /** Register a tab until its Cordis effect is disposed. */
  register(definition: SidebarTabDefinition): () => void {
    if (this.definitions.has(definition.id)) throw new Error(`duplicate sidebar tab: ${definition.id}`)
    this.definitions.set(definition.id, definition)
    this.publish()
    return () => {
      if (this.definitions.get(definition.id) !== definition) return
      this.definitions.delete(definition.id)
      this.publish()
    }
  }

  private publish(): void {
    this.snapshot.set([...this.definitions.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)))
  }
}

function Attention({ source }: { readonly source: HostObservable<boolean> }): ReactNode {
  const visible = useSyncExternalStore(source.subscribe, source.getSnapshot)
  return visible ? <span className={css.attention} data-attention aria-hidden="true"/> : null
}

/** Shared tab strip; selecting a category keeps its unread state unchanged. */
export function SidebarTabs({ tabs, wide, expandSidebar, renderContent, label }: {
  readonly tabs: readonly SidebarTabDefinition[]
  readonly wide: boolean
  readonly expandSidebar: () => void
  readonly renderContent: (id: string) => ReactNode
  readonly label: string
}) {
  const [selected, setSelected] = useState('workspace')
  const active = tabs.find(tab => tab.id === selected)?.id ?? tabs[0]?.id
  if (active === undefined) return null
  return <div className={css.root}>
    <div role="tablist" aria-label={label} aria-orientation={wide ? 'horizontal' : 'vertical'}
      className={wide ? css.tabs : css.rail}>
      {tabs.map(tab => <button type="button" role="tab" key={tab.id} aria-selected={active === tab.id}
        aria-label={tab.title()} tabIndex={active === tab.id ? 0 : -1}
        onClick={() => { setSelected(tab.id); if (!wide) expandSidebar() }}
        onKeyDown={(event) => {
          const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
            : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
          if (delta === 0) return
          event.preventDefault()
          const index = tabs.findIndex(item => item.id === tab.id)
          const target = tabs[(index + delta + tabs.length) % tabs.length]
          if (target === undefined) return
          setSelected(target.id)
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
            [tabs.indexOf(target)]?.focus()
          if (!wide) expandSidebar()
        }}>
        <span aria-hidden="true"><tab.icon size={16}/></span>{wide && <span>{tab.title()}</span>}
        {tab.attention !== undefined && <Attention source={tab.attention}/>}
      </button>)}
    </div>
    {wide && <div role="tabpanel" className={css.content}>{renderContent(active)}</div>}
  </div>
}

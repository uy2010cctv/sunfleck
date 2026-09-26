/** Root-scoped tabs in the right column, independent of a selected Session. */
import type { ComponentType } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** A navigation destination and its live attention state. */
export interface SidebarRightNavigationDefinition {
  /** Stable key shared with the keyed content slot. */
  readonly id: string
  /** Ascending order in the root tab strip. */
  readonly order?: number
  /** Localized tab label read at render time. */
  readonly title: () => string
  /** Existing product icon for the tab. */
  readonly icon: ComponentType<IconProps>
  /** True while this destination needs attention. */
  readonly attention?: HostObservable<boolean>
}

/** Reversible root-navigation registration. */
export class SidebarRightNavigationRegistry {
  private readonly definitions = new Map<string, SidebarRightNavigationDefinition>()
  private readonly snapshot = createSnapshotStore<readonly SidebarRightNavigationDefinition[]>([])
  private readonly occlusion = createSnapshotStore(false)
  readonly source: HostObservable<readonly SidebarRightNavigationDefinition[]> = this.snapshot
  /** Whether the narrow root navigator currently covers the main view. */
  readonly occludesMain: HostObservable<boolean> = this.occlusion

  /** Publish the root renderer's committed narrow-overlay state. */
  reportOcclusion(value: boolean): void {
    if (this.occlusion.getSnapshot() !== value) this.occlusion.set(value)
  }

  /** Current entries in visual order. */
  entries(): readonly SidebarRightNavigationDefinition[] { return this.snapshot.getSnapshot() }

  /** Add one destination; the returned release removes only this registration. */
  register(definition: SidebarRightNavigationDefinition): () => void {
    if (this.definitions.has(definition.id)) throw new Error(`Duplicate right navigation tab: ${definition.id}`)
    this.definitions.set(definition.id, definition)
    this.publish()
    return () => {
      if (this.definitions.get(definition.id) !== definition) return
      this.definitions.delete(definition.id)
      this.publish()
    }
  }

  private publish(): void {
    this.snapshot.set([...this.definitions.values()].sort((a, b) =>
      (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)))
  }
}

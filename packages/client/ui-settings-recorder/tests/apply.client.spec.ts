import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { RecorderSettingsSection } from '../src/client/RecorderSettingsSection.tsx'

describe('ui-settings-recorder apply', () => {
  it('registers inside Local Models without adding a standalone settings section', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: {
      'settings.section': { kind: 'list', scope: 'root' },
      'settings.local-models.recorder': { kind: 'list', scope: 'root' },
    } } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    new TestRemote(ctx, { enterpriseDevice: {
      getRecorderRuntime: vi.fn(), saveRecorderRuntime: vi.fn(), startRecorderRuntime: vi.fn(),
      getRecorderMemoryRuntime: vi.fn(), saveRecorderMemoryRuntime: vi.fn(),
    } })

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toEqual([])
    const entry = slots.entries('settings.local-models.recorder')[0]!
    expect(entry.component).toBe(RecorderSettingsSection)
    expect(entry.options).toMatchObject({ id: 'recorder-models', order: 0 })
    expect(entry.options.label).toBeUndefined()

    await fiber.dispose()
    expect(slots.entries('settings.local-models.recorder')).toEqual([])
  })
})

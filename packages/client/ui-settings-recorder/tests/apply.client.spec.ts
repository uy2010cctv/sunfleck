import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { RecorderSettingsSection } from '../src/client/RecorderSettingsSection.tsx'

describe('ui-settings-recorder apply', () => {
  it('registers one localized settings section and disposes it', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' } } } as never, () => null)
    const locale = new LocaleRuntime(ctx)
    locale.setLocale('zh')
    ctx.provide('locale', locale)
    new TestRemote(ctx, { enterpriseDevice: {
      getRecorderRuntime: vi.fn(), saveRecorderRuntime: vi.fn(), startRecorderRuntime: vi.fn(),
    } })

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = slots.entries('settings.section')[0]!
    expect(entry.component).toBe(RecorderSettingsSection)
    expect(entry.options).toMatchObject({ id: 'recorder-models', order: 15 })
    expect(resolveSlotLabel(entry.options.label)).toBe('录音与语音模型')

    await fiber.dispose()
    expect(slots.entries('settings.section')).toEqual([])
  })
})

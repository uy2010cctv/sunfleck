/** Default Agent model settings layered over a real settings provider. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentDefaultModelConfig, {
  AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE,
  installInitialModelSelection,
} from '../src/index.ts'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

async function boot(): Promise<{
  ctx: Context
  settingsFiber: Context['fiber']
  defaultModel: AgentDefaultModelConfig
}> {
  const ctx = new Context()
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  await ctx.plugin(AgentDefaultModelConfig, {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
  return { ctx, settingsFiber, defaultModel: ctx.agentDefaultModel }
}

describe('AgentDefaultModelConfig', () => {
  it('resolves the user layer over the composition entry', async () => {
    const bench = await boot()
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })

    await bench.defaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: 'high',
    })
    await bench.ctx.fiber.dispose()
  })

  it('clears a stored effort when the saved selection has none', async () => {
    const bench = await boot()
    await bench.defaultModel.saveSelection({
      provider: 'acme-gateway', model: 'acme-large', reasoningEffort: ReasoningEffortId('high'),
    })
    await bench.defaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-plain' })
    expect(bench.defaultModel.currentSelection()).toEqual({ provider: 'acme-gateway', model: 'acme-plain' })
    await bench.ctx.fiber.dispose()
  })

  it('layers a hand-written partial section over the entry', async () => {
    const bench = await boot()
    await bench.settingsFiber.ctx.settings.replace(AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE, {
      model: 'deepseek-reasoner',
    })
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-reasoner',
    })
    await bench.ctx.fiber.dispose()
  })

  it('falls back to the composition entry when the settings provider detaches', async () => {
    const bench = await boot()
    await bench.defaultModel.saveSelection({ provider: 'acme-gateway', model: 'acme-large' })
    expect(bench.defaultModel.currentSelection().provider).toBe('acme-gateway')
    await bench.settingsFiber.dispose()
    expect(bench.defaultModel.currentSelection()).toEqual({
      provider: 'deepseek-official', model: 'deepseek-v4-flash',
    })
    await bench.ctx.fiber.dispose()
  })

  it('keeps the composition entry when no settings provider is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentDefaultModelConfig, { provider: 'p', model: 'm' })
    await ctx.agentDefaultModel.saveSelection({ provider: 'other', model: 'other' })
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'p', model: 'm' })
    await ctx.fiber.dispose()
  })
})

describe('installInitialModelSelection', () => {
  /** Fire the pinned agent/request waterfall once against a stub agent session. */
  async function fireRequest(
    ctx: Context,
    session: { requestHeader(): object | undefined },
    next: LlmCallConfig,
  ): Promise<LlmCallConfig> {
    return await ctx.waterfall(
      'agent/request',
      { agent: { session }, turn: 1, step: 1, signal: new AbortController().signal } as never,
      () => Promise.resolve(next),
    )
  }

  it('pins the creation-time selection over inherited effort until the first request header', async () => {
    const ctx = new Context()
    installInitialModelSelection(ctx, {
      provider: 'mock', model: 'mock-model', reasoningEffort: ReasoningEffortId('high'),
    })
    const session: { requestHeader(): object | undefined } = { requestHeader: () => undefined }
    await expect(fireRequest(ctx, session, {
      provider: 'mock', model: 'mock-model', reasoningEffort: ReasoningEffortId('low'),
    })).resolves.toEqual({ provider: 'mock', model: 'mock-model', reasoningEffort: 'high' })
    await expect(fireRequest(ctx, session, {
      provider: 'other', model: 'mock-model', reasoningEffort: ReasoningEffortId('low'),
    })).resolves.toEqual({ provider: 'other', model: 'mock-model', reasoningEffort: 'low' })
    session.requestHeader = () => ({})
    await expect(fireRequest(ctx, session, {
      provider: 'mock', model: 'mock-model', reasoningEffort: ReasoningEffortId('low'),
    })).resolves.toEqual({ provider: 'mock', model: 'mock-model', reasoningEffort: 'low' })
    await ctx.fiber.dispose()
  })

  it('drops inherited effort without substituting one when the selection carries none', async () => {
    const ctx = new Context()
    installInitialModelSelection(ctx, { provider: 'mock', model: 'mock-model' })
    await expect(fireRequest(ctx, { requestHeader: () => undefined }, {
      provider: 'mock', model: 'mock-model', reasoningEffort: ReasoningEffortId('low'),
    })).resolves.toEqual({ provider: 'mock', model: 'mock-model' })
    await ctx.fiber.dispose()
  })
})

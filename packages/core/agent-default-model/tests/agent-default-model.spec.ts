/** Default model references remain live without a settings service. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import DefaultModel, { installInitialModelSelection } from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'

it('reads complete selections from volatile config and clears omitted reasoning effort', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const live = await liveConfig(ctx, DefaultModel, { provider: 'p', model: 'm' })
  const consumer = ctx.agentDefaultModel
  await live.update({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  expect(consumer.currentSelection()).toEqual({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  await live.replace({ provider: 'p', model: 'm' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
  await consumer.saveSelection({ provider: 'unsaved', model: 'unsaved' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
})

it('persists complete selections through its owning profile entry', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ReasoningEffortId } = await import('@deepseek-ai/dsh-llm')
  const { ctx } = await configurationFixture({ hmr: false })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'next', reasoningEffort: ReasoningEffortId('high') })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'next', reasoningEffort: 'high' })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'final' })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
  const standalone = new Context()
  onTestFinished(() => standalone.fiber.dispose())
  await standalone.plugin(DefaultModel, { provider: 'test', model: 'original' })
  await standalone.agentDefaultModel.saveSelection({ provider: 'test', model: 'ignored' })
  expect(standalone.agentDefaultModel.currentSelection().model).toBe('original')
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

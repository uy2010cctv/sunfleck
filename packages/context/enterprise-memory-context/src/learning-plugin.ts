/** Independently mounted employee self-learning, separate from business-memory review policy. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { learnedEmployeeContext, registerEmployeeLearning, type LearningRepositories } from './learning.ts'

export const name = 'enterprise-employee-learning'
export const inject = ['enterprisePostgres', 'systemPrompt', 'tools', 'sessionProjections']
export interface Config {
  readonly maxChars?: number
  readonly maxLearningBytes?: number
}
export const Config: z<Config> = z.object({
  maxChars: z.natural().min(512).max(64_000).default(12_000),
  maxLearningBytes: z.natural().min(512).max(256_000).default(64_000),
})

/** Mount the tool and the current employee's learned context. */
export function apply(ctx: Context, config: Config): void {
  const repositories = (ctx.get.bind(ctx) as (name: string) => unknown)('enterprisePostgres') as LearningRepositories
  registerEmployeeLearning(ctx, repositories, config.maxLearningBytes ?? 64_000)
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    const agent = context.agent
    const cwd = agent?.session.header.cwd
    if (agent === undefined || cwd === undefined) return result
    const presetId = ctx.sessionProjections.stateOf(agent.session, 'agentPreset')
    if (presetId === undefined || presetId === null) return result
    const learned = await learnedEmployeeContext(repositories, presetId, cwd, config.maxChars ?? 12_000)
    if (learned !== undefined) result.contexts.push({ name: 'enterprise:learned-capabilities', text: learned })
    return result
  })
}

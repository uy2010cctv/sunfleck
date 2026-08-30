import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { optimizeEmployeePromptWithLlm } from '../src/index.ts'

describe('enterprise employee prompt optimizer', () => {
  it('assembles a text-only optimized prompt through the selected provider route', async () => {
    const chunks: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: '负责采购需求澄清、' },
      { type: 'block-end', index: 0, block: { type: 'text', text: '负责采购需求澄清、校验与输出。' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const llm = {
      stream: () => (async function* () { yield* chunks })(),
    }

    await expect(optimizeEmployeePromptWithLlm(llm, {
      provider: 'deepseek', model: 'deepseek-chat', prompt: '负责采购。',
    })).resolves.toEqual({ prompt: '负责采购需求澄清、校验与输出。' })
  })
})

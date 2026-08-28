import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const NOTE = new URL('../../../../.agents/notes/implemented/feature/2026-08-27-enterprise-operations-deck-ui.md', import.meta.url)

describe('enterprise operations deck direction contract', () => {
  it('persists the seeded five-block direction contract', () => {
    const note = readFileSync(NOTE, 'utf8')
    expect(note).toContain('seed: enterprise-operations-deck-v1')
    for (const block of ['FORM', 'TYPE', 'MATERIAL', 'GROUND', 'FIRST VIEWPORT']) {
      expect(note).toContain(`### ${block}`)
    }
  })
})

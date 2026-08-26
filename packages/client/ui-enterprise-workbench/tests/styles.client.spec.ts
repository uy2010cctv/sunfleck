import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const TOKENS = fileURLToPath(new URL('../src/client/tokens.css', import.meta.url))

describe('enterprise theme aliases', () => {
  it('binds on body where the DSH theme presenter publishes its runtime tokens', () => {
    const css = readFileSync(TOKENS, 'utf8')
    expect(css).toMatch(/\nbody\s*\{/u)
    expect(css).not.toMatch(/\n:root\s*\{/u)
  })
})

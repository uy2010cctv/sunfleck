import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const TOKENS = fileURLToPath(new URL('../src/client/tokens.css', import.meta.url))
const WORKBENCH = fileURLToPath(new URL('../src/client/EnterpriseWorkbench.module.css', import.meta.url))

describe('enterprise theme aliases', () => {
  it('binds on body where the DSH theme presenter publishes its runtime tokens', () => {
    const css = readFileSync(TOKENS, 'utf8')
    expect(css).toMatch(/\nbody\s*\{/u)
    expect(css).not.toMatch(/\n:root\s*\{/u)
  })
})

describe('enterprise workbench responsive shell', () => {
  it('keeps the overlay within 320px and switches to a desktop navigation rail at 768px', () => {
    const css = readFileSync(WORKBENCH, 'utf8')
    expect(css).toMatch(/\.workbench\s*\{[^}]*max-inline-size:\s*100%/su)
    expect(css).toMatch(/\.shell\s*\{[^}]*min-inline-size:\s*0/su)
    expect(css).toMatch(/@media\s*\(min-width:\s*48rem\)/u)
    expect(css).toMatch(/\.nav\s*\{[^}]*overflow-x:\s*auto/su)
  })

  it('uses only DSH semantic colors and provides reduced-motion behavior', () => {
    const css = readFileSync(WORKBENCH, 'utf8')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/u)
  })
})

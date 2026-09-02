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
  it('keeps every workbench control inside its grid track with scoped border-box sizing', () => {
    const css = readFileSync(WORKBENCH, 'utf8')
    expect(css).toContain(`.workbench,
.workbench *,
.workbench *::before,
.workbench *::after {
  box-sizing: border-box;
}`)
  })

  it('keeps the overlay within 320px and switches to a desktop navigation rail at 768px', () => {
    const css = readFileSync(WORKBENCH, 'utf8')
    expect(css).toMatch(/\.workbench\s*\{[^}]*max-inline-size:\s*100%/su)
    expect(css).toMatch(/\.shell\s*\{[^}]*min-inline-size:\s*0/su)
    expect(css).toMatch(/@media\s*\(min-width:\s*48rem\)/u)
    expect(css).toMatch(/\.nav\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto/su)
    expect(css).toMatch(/@media\s*\(min-width:\s*48rem\)[\s\S]*\.nav\s*\{[^}]*inline-size:\s*12rem[^}]*flex-direction:\s*column/su)
    expect(css).toMatch(/\.employeeGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/su)
  })

  it('uses only DSH semantic colors and provides reduced-motion behavior', () => {
    const css = readFileSync(WORKBENCH, 'utf8')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/iu)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/u)
    expect(css).toMatch(/::selection/u)
    expect(css).toMatch(/caret-color:\s*var\(/u)
    expect(css).toMatch(/scrollbar-color:\s*var\(/u)
    expect(css).toMatch(/::-webkit-scrollbar/u)
    expect(css).toMatch(/\.inlineField select:focus-visible/u)
  })

  it('stacks the channel binding rail and actions on mobile', () => {
    const css = readFileSync(WORKBENCH, 'utf8')
    expect(css).toMatch(/@media\s*\(max-width:\s*39\.99rem\)[\s\S]*\.connectionPath\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su)
    expect(css).toMatch(/@media\s*\(max-width:\s*39\.99rem\)[\s\S]*\.channelActions\s*\{[^}]*flex-direction:\s*column/su)
    expect(css).toMatch(
      /@media\s*\(max-width:\s*39\.99rem\)[\s\S]*\.channelAttention button\s*\{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\)/su,
    )
    expect(css).toMatch(/\.channelAttention button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--dse-color-focus\)/su)
    expect(css).toMatch(/\.channelTransportGuide a:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--dse-color-focus\)/su)
    expect(css).toMatch(/@media\s*\(max-width:\s*39\.99rem\)[\s\S]*\.channelTransportGuide a\s*\{[^}]*grid-column:\s*1/su)
    expect(css.match(/@media\s*\(max-width:\s*39\.99rem\)[\s\S]*?\.channelActions\s*\{/gu)).toHaveLength(1)
  })
})

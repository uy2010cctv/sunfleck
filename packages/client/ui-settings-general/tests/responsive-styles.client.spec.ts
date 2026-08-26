import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/SettingsRoot.module.css', import.meta.url)),
  'utf8',
)

describe('settings shell responsive styles', () => {
  it('stacks the panel and turns section navigation into a horizontal scroller on small screens', () => {
    expect(css).toMatch(/@media \(max-width: 40rem\)[\s\S]*?\.panel\s*\{[\s\S]*?flex-direction: column;/u)
    expect(css).toMatch(/@media \(max-width: 40rem\)[\s\S]*?\.navList\s*\{[\s\S]*?overflow-x: auto;/u)
    expect(css).toMatch(/@media \(max-width: 40rem\)[\s\S]*?\.panel\s*\{[\s\S]*?background: var\(--dsw-alias-bg-base\);/u)
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const GOVERNANCE = fileURLToPath(new URL('../src/client/governance.module.css', import.meta.url))

describe('enterprise governance form sizing', () => {
  it('contains administrator controls inside their responsive grid tracks', () => {
    const css = readFileSync(GOVERNANCE, 'utf8')
    expect(css).toContain(`.settingsLedger,
.settingsLedger *,
.settingsLedger *::before,
.settingsLedger *::after,
.loginGate,
.loginGate *,
.loginGate *::before,
.loginGate *::after {
  box-sizing: border-box;
}`)
  })
})

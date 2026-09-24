// Web e2e scenario: the enterprise workbench projects the shipped Agent
// Presets and starts native DSH work under the selected employee.
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

async function newestBlankPreset(baseUrl: string): Promise<string | undefined> {
  const response = await fetch(`${baseUrl}/api/session.list`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request', rpcId: 'enterprise-workbench-list', method: 'session.list', payload: {},
    }),
  })
  const body = await response.json() as {
    result: { value?: { items: { blank?: boolean; agentPreset?: string; updatedAt: number }[] } }
  }
  return body.result.value?.items
    .filter(item => item.blank)
    .toSorted((left, right) => right.updatedAt - left.updatedAt)[0]?.agentPreset
}

describe('web e2e: enterprise digital employee workbench', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      agentPresets: { default: 'standard' },
    })
    const executablePath = process.env.DSH_CHROMIUM_EXECUTABLE
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('lists the shipped employees and creates work under the selected preset', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-enterprise-workbench'))

    await page.getByRole('button', { name: 'Open digital employee workbench' }).click()
    const dialog = page.getByRole('dialog', { name: 'Digital employee operations' })
    await dialog.waitFor({ timeout: 15_000 })

    await expect.poll(() => dialog.getByRole('article').count(), { timeout: 15_000 }).toBe(4)
    expect(await dialog.getByRole('heading', { name: '极简模式' }).isVisible()).toBe(true)
    expect(await dialog.getByText('轻量开发员工').isVisible()).toBe(true)
    expect(await dialog.getByText('研发支持').isVisible()).toBe(true)

    await dialog.getByRole('button', { name: 'Start work with 极简模式' }).click()
    await dialog.waitFor({ state: 'hidden', timeout: 15_000 })
    await expect.poll(() => newestBlankPreset(scaffold.baseUrl), { timeout: 15_000 }).toBe('minimal')
  })

  it('drove the enterprise surface without browser errors or warnings', () => {
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  })
})

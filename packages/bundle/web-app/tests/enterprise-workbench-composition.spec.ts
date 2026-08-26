import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const ENTERPRISE_OVERLAY = fileURLToPath(new URL('../../../../apps/cli/config/enterprise.cordis.patch.yml', import.meta.url))

interface PatchRow {
  insert?: Array<{ id?: string; name?: string }>
}

describe('enterprise workbench Web composition', () => {
  it('mounts the enterprise browser plugin', () => {
    const rows = load(
      readFileSync(`${PACKAGE_ROOT}/cordis.patch.yml`, 'utf8'),
      { schema: entryListSchema },
    ) as PatchRow[]
    const inserted = rows.flatMap(row => row.insert ?? [])
    expect(inserted).toContainEqual({
      id: 'ui-enterprise-workbench',
      name: '@deepseek-ai/dsh-client-ui-enterprise-workbench',
    })
  })

  it('declares the enterprise plugin in the published bundle closure', () => {
    const manifest = JSON.parse(readFileSync(`${PACKAGE_ROOT}/package.json`, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-client-ui-enterprise-workbench'])
      .toBe('workspace:^')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-session-persistence-postgres'])
      .toBe('workspace:^')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-enterprise-identity-postgres'])
      .toBe('workspace:^')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-enterprise-catalog'])
      .toBe('workspace:^')
  })

  it('ships an opt-in enterprise security overlay with encrypted credentials, auth, and governance UI', () => {
    const rows = load(readFileSync(ENTERPRISE_OVERLAY, 'utf8'), { schema: entryListSchema }) as Array<{
      id?: string
      name?: string
      insert?: Array<{ id?: string; name?: string }>
    }>
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'credentials', name: '@deepseek-ai/dsh-credentials-encrypted',
    }))
    const inserted = rows.flatMap(row => row.insert ?? [])
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'enterprise-auth-web', name: '@deepseek-ai/dsh-enterprise-auth-web' }),
      { id: 'ui-enterprise-governance', name: '@deepseek-ai/dsh-client-ui-enterprise-governance' },
    ]))
  })
})

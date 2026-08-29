import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { FilesystemEnterpriseCordisArtifactStore } from '../src/index.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('FilesystemEnterpriseCordisArtifactStore', () => {
  it('writes immutable content-addressed source outside PostgreSQL and verifies reads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-cordis-artifacts-'))
    roots.push(root)
    const store = new FilesystemEnterpriseCordisArtifactStore(root)
    const saved = await store.put({
      orgId: 'org-a', pluginId: 'orders-1', name: 'Orders', purpose: 'Validate orders.',
      hostCode: 'return { apply() {} }', clientCode: 'return { apply() {} }',
    })

    expect(saved.artifactRef).toMatch(/^cordis-artifact:\/\/sha256\/[a-f0-9]{64}$/u)
    expect(saved.storageUri).not.toContain('orders-1')
    expect((await stat(saved.storageUri)).mode & 0o777).toBe(0o600)
    await expect(store.read(saved.artifactRef)).resolves.toMatchObject({ hostCode: 'return { apply() {} }' })

    const payload = JSON.parse(await readFile(saved.storageUri, 'utf8')) as Record<string, unknown>
    payload['hostCode'] = 'tampered'
    await writeFile(saved.storageUri, JSON.stringify(payload), { mode: 0o600 })
    await expect(store.read(saved.artifactRef)).rejects.toThrow('digest mismatch')
  })
})

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RecorderMemoryRuntimeStore } from '../src/recorder-memory-runtime.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('recorder memory runtime store', () => {
  it('persists a revisioned model route and projects the owner Session id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recorder-memory-runtime-'))
    roots.push(root)
    const path = join(root, 'runtime.json')
    const store = new RecorderMemoryRuntimeStore(path, {
      provider: 'deepseek-official', model: 'deepseek-flash', timeoutMs: 12_000,
    })

    await expect(store.view('alice')).resolves.toMatchObject({
      revision: 0, provider: 'deepseek-official', model: 'deepseek-flash',
      timeoutMs: 12_000, sessionId: 'recorder-memory-alice',
    })
    const saved = await store.save({
      expectedRevision: 0, provider: 'zai-coding-cn', model: 'glm-5.3-flash', timeoutMs: 20_000,
    }, 'alice')
    expect(saved).toMatchObject({ revision: 1, provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
    expect(saved).not.toHaveProperty('schemaVersion')
    await expect(store.save({
      expectedRevision: 0, provider: 'deepseek-official', model: 'deepseek-flash', timeoutMs: 12_000,
    }, 'alice')).rejects.toThrow(/revision conflict/u)

    const persisted = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    expect(persisted).toMatchObject({ schemaVersion: 1, revision: 1, provider: 'zai-coding-cn', model: 'glm-5.3-flash' })
  })

  it('rejects unsafe fields before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'recorder-memory-runtime-'))
    roots.push(root)
    const store = new RecorderMemoryRuntimeStore(join(root, 'runtime.json'), {
      provider: 'deepseek-official', model: 'deepseek-flash', timeoutMs: 12_000,
    })

    await expect(store.save({
      expectedRevision: 0, provider: '', model: 'x', timeoutMs: 20_000,
    }, 'alice')).rejects.toThrow(/provider/u)
    await expect(store.save({
      expectedRevision: 0, provider: 'p', model: 'x', timeoutMs: 999,
    }, 'alice')).rejects.toThrow(/timeout/u)
  })
})

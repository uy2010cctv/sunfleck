import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('keeps Client compiler faces out of the Host build before Remote generation', () => {
  const visited = new Set<string>()
  const clientFaces: string[] = []
  const walk = (file: string): void => {
    if (visited.has(file)) return
    visited.add(file)
    const result = ts.readConfigFile(file, ts.sys.readFile)
    if (result.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(result.error.messageText, '\n'))
    const config = result.config as { references?: readonly { path: string }[] }
    if (file.endsWith('tsconfig.client.json')) clientFaces.push(file)
    for (const reference of config.references ?? []) {
      const target = resolve(dirname(file), reference.path)
      walk(existsSync(`${target}/tsconfig.json`) ? `${target}/tsconfig.json` : target)
    }
  }
  walk(resolve('tsconfig.host.json'))
  expect(clientFaces).toEqual([])
})

it('typechecks worker page tests in the Client aggregate', () => {
  const files = (name: string): readonly string[] => {
    const path = resolve(name)
    const config = ts.readConfigFile(path, ts.sys.readFile)
    return ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(path)).fileNames
  }
  const pageTests = (file: string): boolean => file.includes('/webworker-runtime/tests/client/')
    || file.endsWith('/webworker-runtime/tests/transport/tunnel-client.spec.ts')
  expect(files('tsconfig.host.json').filter(pageTests)).toEqual([])
  expect(files('tsconfig.client.json').filter(pageTests).length).toBeGreaterThan(0)
})

it('bundles the Desktop app after its workspace library inputs', () => {
  expect(readFileSync('tsdown.config.ts', 'utf8')).not.toContain("'apps/desktop'")
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }
  expect(manifest.scripts['build:lib:host']).toContain('&& pnpm --filter @deepseek-ai/dsh-desktop run bundle')
})

it('emits workspace-file plugin inputs before the Client bundle pass', () => {
  const result = ts.readConfigFile(resolve('tsconfig.client.json'), ts.sys.readFile)
  const config = result.config as { references: readonly { path: string }[] }
  expect(config.references.some(reference => reference.path === './packages/client/ui-workspace-files')).toBe(true)
})

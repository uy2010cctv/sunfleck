import type { CordisPackageDraft, CordisValidationCheck, DshPluginDependency } from './types.ts'

/** Data used by `EnterpriseCordisScanner`. */
export interface EnterpriseCordisScanner {
  readonly id: string
  scan(draft: CordisPackageDraft): Promise<readonly CordisValidationCheck[]>
}

const ALLOWED_LICENSES = new Set([
  'MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'LicenseRef-Proprietary',
])

function result(id: CordisValidationCheck['id'], passed: boolean, message: string): CordisValidationCheck {
  return { id, status: passed ? 'passed' : 'failed', message }
}

function exactDependency(dependency: DshPluginDependency): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(dependency.version)
    && /^sha512-[A-Za-z0-9+/]{32,}={0,2}$/u.test(dependency.integrity)
    && ALLOWED_LICENSES.has(dependency.license)
    && /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu.test(dependency.name)
}

/** Mandatory built-in policy scanner. Deployments may append antivirus/SCA scanners through the same seam. */
export class BuiltinEnterpriseCordisScanner implements EnterpriseCordisScanner {
  readonly id = 'builtin-enterprise-policy-v1'

  async scan(draft: CordisPackageDraft): Promise<readonly CordisValidationCheck[]> {
    const source = `${draft.hostCode ?? ''}\n${draft.clientCode ?? ''}`
    const malwareSignature
      = /(?:\beval\s*\(|\bFunction\s*\(|\bWebAssembly\b|__proto__|prototype\s*\[|data:text\/javascript|child_process|process\.binding)/iu
    const malwareFree = !malwareSignature.test(source)
    const license = draft.manifest.license
    const dependencies = draft.manifest.dependencies ?? []
    return [
      result('malware', malwareFree, malwareFree
        ? 'No dynamic-eval, WebAssembly, prototype-mutation, or process-binding signature was found.'
        : 'A prohibited executable or prototype-mutation signature was found.'),
      result('license', license !== undefined && ALLOWED_LICENSES.has(license), license === undefined
        ? 'Package license is missing.' : ALLOWED_LICENSES.has(license)
          ? `Package license ${license} is allowed.` : `Package license ${license} is not allowed.`),
      result('supply-chain', dependencies.every(exactDependency), dependencies.length === 0
        ? 'Package declares no external dependencies.'
        : dependencies.every(exactDependency)
          ? 'Dependencies use exact versions, SHA-512 integrity, valid package names, and allowed licenses.'
          : 'Every dependency must use an exact version, SHA-512 integrity, a valid package name, and an allowed license.'),
    ]
  }
}

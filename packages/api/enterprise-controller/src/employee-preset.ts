/** Employee Release declarations installed into the 0.1.7 Agent preset registry. */
import { load as loadYaml } from 'js-yaml'
import type { Context } from '@deepseek-ai/cordis'
import { entryListProblem, type PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EnterpriseEmployeeRelease } from './contract/employees.ts'

/** Identity and presentation fields one published employee release installs into its Agent preset. */
export interface EmployeePresetDefinition {
  readonly name: string
  readonly description?: string
  readonly position?: string
  readonly department?: string
  readonly capabilities?: readonly string[]
  readonly prompt: string
}

/** Extract the employee identity fields of one published Release.
 * @param release - the immutable Release whose snapshot profile carries the identity.
 * @returns the validated definition.
 * @throws when the snapshot profile omits the employee name or responsibility prompt.
*/
export function employeePresetDefinition(release: EnterpriseEmployeeRelease): EmployeePresetDefinition {
  const profile = release.snapshot.profile
  const required = (field: string): string => {
    const value = profile[field]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`employee release ${release.releaseId} has no ${field}`)
    }
    return value.trim()
  }
  const optional = (field: string): string | undefined => {
    const value = profile[field]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const capabilities = Array.isArray(profile['capabilities'])
    ? profile['capabilities'].filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    : []
  const description = optional('description')
  const position = optional('position')
  const department = optional('department')
  return {
    name: required('name'), prompt: required('prompt'),
    ...description === undefined ? {} : { description },
    ...position === undefined ? {} : { position },
    ...department === undefined ? {} : { department },
    capabilities,
  }
}

/** Compose the persona prose an employee preset mounts, CJK-aware like the roster it serves.
 * @param input - the validated employee identity.
 * @returns the persona text with the identity-consistency rules appended.
*/
export function employeePersona(input: EmployeePresetDefinition): string {
  if (/[\u3400-\u9fff]/u.test([
    input.name, input.description, input.position, input.department, input.prompt,
  ].filter((value) => value !== undefined).join(''))) {
    return `${[
      `你是企业数字员工“${input.name.trim()}”`,
      ...input.position?.trim() ? [`岗位是“${input.position.trim()}”`] : [],
      ...input.department?.trim() ? [`所属部门是“${input.department.trim()}”`] : [],
    ].join('，')}。\n\n${input.prompt.trim()}\n\n身份一致性规则：当用户询问你是谁或要求自我介绍时，应基于上述数字员工身份、岗位和职责回答；不要把自己描述为通用编码 Agent 或 DSH 系统本身。`
  }
  return `${[
    `You are the enterprise digital employee "${input.name.trim()}"`,
    ...input.position?.trim() ? [`your position is "${input.position.trim()}"`] : [],
    ...input.department?.trim() ? [`your department is "${input.department.trim()}"`] : [],
  ].join(', ')}.

${input.prompt.trim()}

Identity consistency: when asked who you are or to introduce yourself, answer from this digital-employee identity, position, and responsibilities. Do not describe yourself as a generic coding agent or as the DSH system itself.`
}

/** Derive the declaration registered for one released employee: the deployment default preset's
 * composition with its persona row rewritten to the employee identity. Plugins and tools follow
 * the default the deployment chose for new sessions, mirroring the copy-then-rewrite flow this
 * migration replaces.
 * @param ctx - the authenticated enterprise Host context holding the Agent preset registry.
 * @param presetId - the preset identity the release publishes under.
 * @param input - the validated employee identity.
 * @returns the registry declaration to register.
 * @throws when the default preset's composition is missing, invalid, or has no persona row.
*/
export async function employeePresetDeclaration(
  ctx: Context,
  presetId: string,
  input: EmployeePresetDefinition,
): Promise<PresetDefinition> {
  const document = await ctx.agentPresets.readDocument(ctx.agentPresets.defaultId)
  const rows = loadYaml(document.content, { schema: entryListSchema })
  if (!Array.isArray(rows)) throw new Error(`agent preset ${document.agentPreset} does not declare a plugin row list`)
  const problem = entryListProblem(rows)
  if (problem !== undefined) throw new Error(`agent preset ${document.agentPreset} has an invalid composition: ${problem}`)
  const plugins = rows as unknown as PresetDefinition['plugins']
  const persona = plugins.find(row => row.id === 'persona' && row.name === '@deepseek-ai/dsh-persona')
  if (persona === undefined) {
    throw new Error(`agent preset ${document.agentPreset} has no editable persona row, so it cannot carry an employee identity`)
  }
  persona.config = {
    ...(typeof persona.config === 'object' && persona.config !== null ? persona.config : {}),
    prefix: employeePersona(input),
  }
  return {
    id: presetId,
    name: input.name,
    ...input.description === undefined ? {} : { description: input.description },
    plugins,
  }
}

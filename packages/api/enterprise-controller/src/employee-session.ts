/** Independent Session projection for the employee layered over one Agent work mode. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { Context } from '@deepseek-ai/cordis'
import * as Persona from '@deepseek-ai/dsh-persona'
import type { EmployeeReleaseSelection } from './contract/work.ts'

const selectionSchema = z.object({
  employeeId: z.string(), releaseId: z.string(), releaseVersion: z.number().int().positive().optional(),
  orgId: z.string(), ownerUserId: z.string(),
})
const stateSchema = z.union([selectionSchema, z.null()])
const viewSchema = z.union([selectionSchema.pick({ employeeId: true, releaseId: true, releaseVersion: true }), z.null()])

/** Latest employee selection, independent of `agentPreset` mode changes. */
export const employeeReleaseProjectionDefinition = {
  key: 'enterpriseEmployeeRelease',
  stateSchema,
  init: () => null,
  apply: (state, event) => event.type === 'enterprise-employee/selected'
    ? event.data
    : event.type === 'enterprise-employee/cleared' ? null : state,
  wire: { viewSchema, view: (state: EmployeeReleaseSelection | null) => state === null ? null : {
    employeeId: state.employeeId, releaseId: state.releaseId,
    ...(state.releaseVersion === undefined ? {} : { releaseVersion: state.releaseVersion }),
  } },
  stateVersion: 1,
} satisfies ProjectionDefinition<'enterpriseEmployeeRelease', EmployeeReleaseSelection | null>

/** Mount an employee identity inside an Agent's own scope over its work-mode persona.
 * @param agentCtx - Agent context already joined to the selected work mode.
 * @param prompt - Published employee persona text.
 * @returns disposer for replacement or Agent teardown.
 */
export async function installEmployeePersona(agentCtx: Context, prompt: string): Promise<() => Promise<void>> {
  const fiber = await agentCtx.plugin(Persona, { prefix: prompt })
  return () => fiber.dispose()
}

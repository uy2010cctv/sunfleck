import { describe, expect, it } from 'vitest'
import { SessionSeq } from '@deepseek-ai/dsh-session'
import { employeeReleaseProjectionDefinition } from '../src/employee-session.ts'
import { installEmployeePersona } from '../src/employee-session.ts'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { createScope } from '@deepseek-ai/dsh-scope'
import * as Persona from '@deepseek-ai/dsh-persona'
import type { EmployeeReleaseSelection } from '../src/contract/work.ts'


describe('employee selection beside a work mode', () => {
  it('shadows the mode persona in the Agent scope without removing its other prompt sections', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { personaPrefix: 'Deployment' })
      const modeKey = {}
      const mode = createScope(ctx, modeKey)
      await mode.ctx.plugin(Persona, { prefix: 'Mode persona' })
      await mode.ctx.plugin({ inject: ['systemPrompt'], apply(child: Context) {
        child.systemPrompt.section({ name: 'mode:tools', order: 100, text: 'Mode tools remain' })
      } })
      const agentKey = {}
      const agent = createScope(mode.ctx, agentKey, { parent: modeKey })
      const dispose = await installEmployeePersona(agent.ctx, 'Employee persona')
      const assembly = await ctx.systemPrompt.assemble({ scope: agentKey })
      expect(assembly.sections.find(row => row.name === PERSONA_PREFIX_SECTION)?.text).toBe('Employee persona')
      expect(assembly.sections.some(row => row.text === 'Mode tools remain')).toBe(true)
      await dispose()
      expect((await ctx.systemPrompt.assemble({ scope: agentKey })).sections.find(row => row.name === PERSONA_PREFIX_SECTION)?.text)
        .toBe('Mode persona')
    } finally { await ctx.fiber.dispose() }
  })
  it('records the employee release independently of the Session preset', () => {
    const definition = employeeReleaseProjectionDefinition
    const selection = {
      employeeId: 'employee-a', releaseId: 'release-v2', releaseVersion: 2, orgId: 'org-a', ownerUserId: 'user-a',
    }
    let state: EmployeeReleaseSelection | null = definition.init()
    expect(state).toBeNull()
    state = definition.apply(state, {
      type: 'enterprise-employee/selected', seq: SessionSeq(0), time: 1, data: selection,
    })
    expect(definition.wire.view(state)).toEqual({ employeeId: 'employee-a', releaseId: 'release-v2', releaseVersion: 2 })
    state = definition.apply(state, {
      type: 'agent-preset/selected', seq: SessionSeq(1), time: 2, data: { agentPreset: 'minimal' },
    })
    expect(state).toEqual(selection)
    state = definition.apply(state, {
      type: 'enterprise-employee/cleared', seq: SessionSeq(2), time: 3, data: {},
    })
    expect(state).toBeNull()
  })
})

/** Enterprise team charter validation independent of runtime execution. */
import { EnterpriseOperationsError } from './repository.ts'
import type { EnterpriseTeamDefinition, TeamActorRef } from './types.ts'

function actorKey(actor: TeamActorRef): string {
  return actor.kind === 'human' ? `human:${actor.userId}` : `agent:${actor.employeeReleaseId}`
}

function invalid(teamId: string): never {
  throw new EnterpriseOperationsError('invalid-state', 'team-definition', teamId)
}

function positiveLimit(value: number | undefined, teamId: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) invalid(teamId)
}

/**
 * Validate durable invariants, including the complete charter required by active definitions.
 * @param definition - Candidate durable team definition.
 */
export function validateTeamDefinition(definition: EnterpriseTeamDefinition): void {
  if (definition.allowedUserIds !== undefined && definition.visibility !== 'restricted') invalid(definition.teamId)
  positiveLimit(definition.attentionPolicy.openDecisionLimit, definition.teamId)
  positiveLimit(definition.attentionPolicy.workInProgressLimit, definition.teamId)
  if (definition.state !== 'active') return

  if (definition.name.trim() === '' || definition.northStar.trim() === ''
    || definition.ownerUserId.trim() === '' || definition.leaderEmployeeReleaseId.trim() === '') invalid(definition.teamId)
  const roleIds = new Set<string>()
  for (const role of definition.roles) {
    if (role.roleId.trim() === '' || role.name.trim() === '' || role.responsibility.trim() === ''
      || roleIds.has(role.roleId)) invalid(definition.teamId)
    roleIds.add(role.roleId)
  }
  const actors = new Set<string>()
  let ownerPresent = false
  let leaderPresent = false
  for (const member of definition.roster) {
    const key = actorKey(member.actor)
    const actorId = member.actor.kind === 'human' ? member.actor.userId : member.actor.employeeReleaseId
    if (actorId.trim() === '' || actors.has(key) || !roleIds.has(member.roleId)) invalid(definition.teamId)
    actors.add(key)
    ownerPresent ||= member.actor.kind === 'human' && member.actor.userId === definition.ownerUserId
    leaderPresent ||= member.actor.kind === 'agent'
      && member.actor.employeeReleaseId === definition.leaderEmployeeReleaseId
  }
  if (!ownerPresent || !leaderPresent) invalid(definition.teamId)
  const verification = definition.verificationPolicy
  if (typeof verification.verifierRequired !== 'boolean'
    || !Array.isArray(verification.rubricRefs)
    || verification.rubricRefs.some(ref => typeof ref !== 'string' || ref.trim() === '')
    || typeof verification.highRiskHumanReviewRequired !== 'boolean') invalid(definition.teamId)
  if (definition.attentionPolicy.decisionQueue !== 'centralized') invalid(definition.teamId)
}

/**
 * Reject definitions that cannot start runtime work.
 * @param definition - Definition selected for execution.
 */
export function assertTeamDefinitionExecutable(definition: EnterpriseTeamDefinition): void {
  if (definition.state !== 'active') invalid(definition.teamId)
  validateTeamDefinition(definition)
}

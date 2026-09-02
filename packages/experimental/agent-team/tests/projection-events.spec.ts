import { describe, expect, it } from 'vitest'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap, SessionEventType } from '@deepseek-ai/dsh-session'
import { teamProjectionDefinition } from '../src/projection.ts'
import type { TeamProjectionState, TeamState } from '../src/projection.ts'
import { TeamId, TeamMessageId, TeamTaskId } from '../src/types.ts'
import type {
  TeamDecisionSnapshot,
  TeamHumanMemberSnapshot,
  TeamMemberSnapshot,
  TeamMessageSnapshot,
  TeamReleaseSnapshot,
  TeamRunSnapshot,
  TeamTaskSnapshot,
} from '../src/types.ts'

const ROOT = SessionId('team-root')
const TEAM = TeamId(ROOT)
const CHILD = SessionId('child-a')

function event<T extends SessionEventType>(type: T, data: SessionEventMap[T], seq: SessionSeq): SessionEvent<T> {
  return { type, data, seq, time: seq } as SessionEvent<T>
}

function project(rootId: SessionId, events: readonly SessionEvent[]): TeamProjectionState {
  let state = teamProjectionDefinition.init({ version: 0, id: rootId, createdAt: 0, isSeeded: false })
  for (const event of events) state = teamProjectionDefinition.apply(state, event)
  return state
}

function teamState(projected: TeamProjectionState): TeamState {
  if (projected.failure !== undefined) throw new Error(projected.failure)
  return projected
}

function projectTeam(rootId: SessionId, events: readonly SessionEvent[]): TeamState {
  return teamState(project(rootId, events))
}

/** Queued-minus-delivered mail retained by the projection. */
function pending(state: TeamState): TeamMessageSnapshot[] {
  return state.messages.filter(message => !state.delivered.includes(message.id))
}

/** Whether one Team state contains no projected records. */
function isEmptyState(state: TeamState): boolean {
  return state.members.length === 0 && state.tasks.length === 0
    && state.messages.length === 0 && state.delivered.length === 0
}

function member(overrides: Partial<TeamMemberSnapshot> = {}): TeamMemberSnapshot {
  return {
    id: CHILD,
    name: 'worker-a',
    description: 'worker',
    provider: 'spawn',
    context: 'fresh',
    phase: 'provisioning',
    ...overrides,
  }
}

function task(overrides: Partial<TeamTaskSnapshot> = {}): TeamTaskSnapshot {
  return {
    id: TeamTaskId('task-1'),
    revision: 1,
    subject: 'subject',
    description: 'description',
    status: 'pending',
    blockedBy: [],
    writeScopes: [],
    ...overrides,
  }
}

function message(overrides: Partial<TeamMessageSnapshot> = {}): TeamMessageSnapshot {
  return {
    id: TeamMessageId('message-1'),
    senderId: ROOT,
    senderName: 'lead',
    targetId: CHILD,
    delivery: 'quiet',
    content: [{ type: 'text', text: 'hello' }],
    ...overrides,
  }
}

function release(releaseId = 'release-lead'): TeamReleaseSnapshot {
  return {
    releaseId,
    digest: `${releaseId}-digest`,
    presetId: `${releaseId}-preset`,
    modelRef: { provider: 'mock', model: `${releaseId}-model` },
    capabilityBindings: [],
  }
}

function run(overrides: Partial<TeamRunSnapshot> = {}): TeamRunSnapshot {
  return {
    runId: 'run-a',
    orgId: 'org-a',
    teamDefinitionRevision: 4,
    workspaceId: 'workspace-a',
    operationId: 'team-run:start:run-a',
    state: 'starting',
    runtimeRevision: 1,
    actor: { userId: 'owner-a', displayName: 'Owner A' },
    leader: { sessionId: ROOT, roleId: 'lead', release: release() },
    ...overrides,
  }
}

function human(overrides: Partial<TeamHumanMemberSnapshot> = {}): TeamHumanMemberSnapshot {
  return {
    userId: 'reviewer-a',
    displayName: 'Reviewer A',
    roleId: 'reviewer',
    ...overrides,
  }
}

function decision(overrides: Partial<TeamDecisionSnapshot> = {}): TeamDecisionSnapshot {
  return {
    decisionId: 'decision-a',
    runId: 'run-a',
    kind: 'clarification',
    question: 'Proceed?',
    options: ['yes', 'no'],
    contextDigest: 'context-a',
    assigneeUserId: 'reviewer-a',
    state: 'open',
    revision: 1,
    runtimeRevision: 3,
    operationId: 'team-decision:project:decision-a',
    ...overrides,
  }
}

describe('Agent Teams projection events', () => {
  it('projects legacy Agent records beside first-class Human and enterprise Agent metadata', () => {
    const enterprise = member({
      id: SessionId('child-enterprise'),
      name: 'buyer',
      employeeReleaseId: 'release-buyer',
      roleId: 'buyer',
      release: release('release-buyer'),
    })
    const state = projectTeam(ROOT, [
      event('team/member', { version: 1, teamId: TEAM, member: member() }, SessionSeq(0)),
      event('team/human-member', { version: 1, teamId: TEAM, member: human() }, SessionSeq(1)),
      event('team/member', { version: 1, teamId: TEAM, member: enterprise }, SessionSeq(2)),
    ])

    expect(state.members.find(candidate => candidate.id === CHILD)).toEqual(member())
    expect(state.members.find(candidate => candidate.id === enterprise.id)).toEqual(enterprise)
    expect(state.humans.find(candidate => candidate.userId === 'reviewer-a')).toEqual(human())
  })

  it('folds monotonic TeamRun and Decision events with operation idempotency', () => {
    const starting = event('team/run', { version: 1, teamId: TEAM, run: run() }, SessionSeq(0))
    const active = event('team/run', {
      version: 1,
      teamId: TEAM,
      run: run({ state: 'active', runtimeRevision: 2 }),
    }, SessionSeq(1))
    const projected = event('team/decision', {
      version: 1,
      teamId: TEAM,
      decision: decision(),
    }, SessionSeq(2))
    const answered = event('team/decision', {
      version: 1,
      teamId: TEAM,
      decision: decision({
        state: 'answered',
        answer: 'yes',
        revision: 2,
        runtimeRevision: 4,
        operationId: 'team-decision:respond:decision-a:key-a',
        respondedBy: { userId: 'reviewer-a', displayName: 'Reviewer A' },
      }),
    }, SessionSeq(3))
    const state = projectTeam(ROOT, [starting, active, projected, answered])

    expect(state.run).toEqual(run({ state: 'active', runtimeRevision: 2 }))
    expect(state.decisions.find(candidate => candidate.decisionId === 'decision-a')).toEqual(answered.data.decision)
    expect(state.runtimeRevision).toBe(4)
    expect(state.operations.find(candidate => candidate.operationId === 'team-run:start:run-a')?.receipt).toEqual({ runtimeRevision: 2, sourceEventSeq: 1 })
    expect(state.operations.find(candidate => candidate.operationId === 'team-decision:respond:decision-a:key-a')?.receipt).toEqual({
      runtimeRevision: 4,
      sourceEventSeq: 3,
    })
  })

  it('rejects runtime revision gaps, stale decision CAS, and conflicting operation reuse', () => {
    const starting = event('team/run', { version: 1, teamId: TEAM, run: run() }, SessionSeq(0))
    expect(() => projectTeam(ROOT, [starting, event('team/run', {
      version: 1,
      teamId: TEAM,
      run: run({ state: 'active', runtimeRevision: 3 }),
    }, SessionSeq(1))])).toThrow(/runtime revision is not contiguous/)

    const active = event('team/run', {
      version: 1, teamId: TEAM, run: run({ state: 'active', runtimeRevision: 2 }),
    }, SessionSeq(1))
    const projected = event('team/decision', {
      version: 1, teamId: TEAM, decision: decision(),
    }, SessionSeq(2))
    expect(() => projectTeam(ROOT, [starting, active, projected, event('team/decision', {
      version: 1,
      teamId: TEAM,
      decision: decision({
        state: 'answered', answer: 'yes', revision: 3, runtimeRevision: 4,
        operationId: 'team-decision:respond:decision-a:key-a',
      }),
    }, SessionSeq(3))])).toThrow(/decision .* revision is not contiguous/)

    expect(() => projectTeam(ROOT, [starting, active, event('team/run', {
      version: 1,
      teamId: TEAM,
      run: run({
        state: 'cancelled',
        runtimeRevision: 3,
        operationId: 'team-run:start:run-a',
      }),
    }, SessionSeq(2))])).toThrow(/operation .* changed intent/)
  })

  it('projects current-team records independently from inherited records', () => {
    const records: SessionEvent[] = [
      event('team/member', { version: 1, teamId: TeamId('ancestor'), member: member() }, SessionSeq(0)),
      event('team/member', { version: 1, teamId: TEAM, member: member() }, SessionSeq(1)),
      event('team/member', {
        version: 1,
        teamId: TEAM,
        member: member({ phase: 'active' }),
      }, SessionSeq(2)),
      event('team/task', { version: 1, teamId: TEAM, task: task({ id: TeamTaskId('task-7') }) }, SessionSeq(3)),
      event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, SessionSeq(4)),
    ]
    const projected = project(ROOT, records)
    const state = teamState(projected)

    expect(state).toMatchObject({ id: TEAM })
    expect(state.members).toHaveLength(1)
    expect(state.tasks).toHaveLength(1)
    expect(pending(state)).toHaveLength(1)
    expect(state.nextTaskNumber).toBe(8)
    expect(state.members.find(member => member.id === CHILD)?.name).toBe('worker-a')
    expect(teamProjectionDefinition.stateSchema.parse(JSON.parse(JSON.stringify(projected))))
      .toEqual(projected)
  })

  it('enforces teammate identity and lifecycle', () => {
    const base = event('team/member', { version: 1, teamId: TEAM, member: member() }, SessionSeq(0))
    expect(() => projectTeam(ROOT, [event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'active' }),
    }, SessionSeq(0))])).toThrow(/must begin provisioning/)
    expect(() => projectTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ name: 'renamed', phase: 'active' }),
    }, SessionSeq(1))])).toThrow(/immutable identity/)
    expect(() => projectTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'active' }),
    }, SessionSeq(1)), event('team/member', {
      version: 1,
      teamId: TEAM,
      member: member({ phase: 'failed' }),
    }, SessionSeq(2))])).toThrow(/invalid active -> failed/)

    const duplicateName = member({ id: SessionId('child-b') })
    expect(() => projectTeam(ROOT, [base, event('team/member', {
      version: 1,
      teamId: TEAM,
      member: duplicateName,
    }, SessionSeq(1))])).toThrow(/name .* reused/)
  })

  it('enforces task revision continuity', () => {
    const first = event('team/task', { version: 1, teamId: TEAM, task: task() }, SessionSeq(0))
    expect(() => projectTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 2 }),
    }, SessionSeq(0))])).toThrow(/begin at revision 1/)
    expect(() => projectTeam(ROOT, [first, event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ revision: 3 }),
    }, SessionSeq(1))])).toThrow(/revision is not contiguous/)
  })

  it('rejects every invalid persisted task dependency relation', () => {
    const first = event('team/task', { version: 1, teamId: TEAM, task: task() }, SessionSeq(0))
    const second = event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({
        id: TeamTaskId('task-2'),
        blockedBy: [TeamTaskId('task-1')],
      }),
    }, SessionSeq(1))
    const invalid: Array<{ records: SessionEvent[]; message: RegExp }> = [
      {
        records: [event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ blockedBy: [TeamTaskId('missing')] }),
        }, SessionSeq(0))],
        message: /blocker task "missing" .* is missing or deleted/,
      },
      {
        records: [event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ blockedBy: [TeamTaskId('task-1')] }),
        }, SessionSeq(0))],
        message: /cannot block itself/,
      },
      {
        records: [first, event('team/task', {
          ...second.data,
          task: { ...second.data.task, blockedBy: [TeamTaskId('task-1'), TeamTaskId('task-1')] },
        }, SessionSeq(1))],
        message: /repeats blocker/,
      },
      {
        records: [first, second, event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ revision: 2, blockedBy: [TeamTaskId('task-2')] }),
        }, SessionSeq(2))],
        message: /dependency cycle/,
      },
      {
        records: [first, second, event('team/task', {
          version: 1,
          teamId: TEAM,
          task: task({ revision: 2, status: 'deleted' }),
        }, SessionSeq(2))],
        message: /blocker task "task-1" .* is missing or deleted/,
      },
    ]

    for (const { records, message: expected } of invalid) {
      expect(() => projectTeam(ROOT, records)).toThrow(expected)
    }
  })

  it('leaves numeric allocation unchanged for a branded nonstandard task id', () => {
    const state = projectTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ id: TeamTaskId('external-task') }),
    }, SessionSeq(0))])
    expect(state.nextTaskNumber).toBe(1)
  })

  it('rejects a persisted numeric task id outside the safe integer range', () => {
    expect(() => projectTeam(ROOT, [event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task({ id: TeamTaskId('task-9007199254740992') }),
    }, SessionSeq(0))])).toThrow(/persisted Agent Teams team\/task payload is invalid/)
  })

  it('enforces mailbox queue and acknowledgement relations', () => {
    const queued = event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, SessionSeq(0))
    const delivered = event('team/message/delivered', {
      version: 1,
      teamId: TEAM,
      messageId: TeamMessageId('message-1'),
      targetId: CHILD,
    }, SessionSeq(1))
    expect(pending(projectTeam(ROOT, [queued, delivered]))).toEqual([])
    expect(() => projectTeam(ROOT, [queued, queued])).toThrow(/queued twice/)
    expect(() => projectTeam(ROOT, [delivered])).toThrow(/delivered before queueing/)
    expect(() => projectTeam(ROOT, [queued, event('team/message/delivered', {
      ...delivered.data,
      targetId: SessionId('other'),
    }, SessionSeq(1))])).toThrow(/target changed/)
    expect(() => projectTeam(ROOT, [queued, delivered, { ...delivered, seq: SessionSeq(2) }])).toThrow(/delivered twice/)
  })

  it('validates every current-version persisted payload before projecting it', () => {
    const malformed = [
      {
        ...event('team/member', { version: 1, teamId: TEAM, member: member() }, SessionSeq(0)),
        data: { version: 1, teamId: TEAM, member: { ...member(), name: 42 } },
      },
      {
        ...event('team/task', { version: 1, teamId: TEAM, task: task() }, SessionSeq(0)),
        data: { version: 1, teamId: TEAM, task: { ...task(), blockedBy: [42] } },
      },
      {
        ...event('team/message/queued', { version: 1, teamId: TEAM, message: message() }, SessionSeq(0)),
        data: {
          version: 1,
          teamId: TEAM,
          message: { ...message(), content: [{ type: 'text', text: 42 }] },
        },
      },
      {
        ...event('team/message/delivered', {
          version: 1,
          teamId: TEAM,
          messageId: TeamMessageId('message-1'),
          targetId: CHILD,
        }, SessionSeq(0)),
        data: {
          version: 1,
          teamId: TEAM,
          messageId: TeamMessageId('message-1'),
          targetId: 42,
        },
      },
      {
        ...event('team/member', { version: 1, teamId: TEAM, member: member() }, SessionSeq(0)),
        data: { version: 1, teamId: TEAM, member: member(), unexpected: true },
      },
      {
        ...event('team/task', { version: 1, teamId: TEAM, task: task() }, SessionSeq(0)),
        data: { version: 1, teamId: 42, task: task() },
      },
    ] as unknown as SessionEvent[]

    for (const candidate of malformed) {
      expect(() => projectTeam(ROOT, [candidate]))
        .toThrow(/persisted Agent Teams .* payload is invalid/)
    }
  })

  it('retains merge-extensible content blocks while rejecting malformed core variants', () => {
    const extension = { type: 'plugin/custom', payload: { value: 1 } } as never
    const state = projectTeam(ROOT, [event('team/message/queued', {
      version: 1,
      teamId: TEAM,
      message: message({ content: [extension] }),
    }, SessionSeq(0))])
    expect(pending(state)[0]?.content).toEqual([extension])
  })

  it('records unsupported event versions without applying them', () => {
    const invalid = event('team/task', {
      version: 2 as 1,
      teamId: TEAM,
      task: task(),
    }, SessionSeq(0))
    const later = event('team/task', {
      version: 1,
      teamId: TEAM,
      task: task(),
    }, SessionSeq(1))
    const state = project(ROOT, [invalid, later])
    expect(state.failure).toMatch(/unsupported Agent Teams event version 2/)
    expect(isEmptyState(state)).toBe(true)
  })

  it('isolates unsupported inherited Team records from the current Team', () => {
    const inherited = event('team/task', {
      version: 2 as 1,
      teamId: TeamId('ancestor'),
      task: task(),
    }, SessionSeq(0))
    const projected = project(ROOT, [inherited])
    expect(projected.failure).toBeUndefined()
    expect(isEmptyState(teamState(projected))).toBe(true)
  })

  it('ignores malformed current-version records inherited from another Team', () => {
    const inherited = {
      ...event('team/task', {
        version: 1,
        teamId: TeamId('ancestor'),
        task: task(),
      }, SessionSeq(0)),
      data: {
        version: 1,
        teamId: TeamId('ancestor'),
        task: { ...task(), subject: 42 },
      },
    } as unknown as SessionEvent
    expect(isEmptyState(projectTeam(ROOT, [inherited]))).toBe(true)
  })
})

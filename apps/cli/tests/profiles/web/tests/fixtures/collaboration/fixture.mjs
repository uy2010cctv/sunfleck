/** Deterministic external model and seed data for the real enterprise Web profile. */

import { LlmAdapter } from '@deepseek-ai/dsh-llm'

/** Host services needed by the seed transaction and readiness observer. */
export const inject = ['llm', 'loader']

/** Mount the external model adapter and publish fixture readiness after Loader settlement.
 * @param ctx - Real profile context.
 * @param config - Private per-test Workspace directory.
 */
export function apply(ctx, config) {
  ctx.logger.exporter({ export(message) {
    if (message.args.some(value => String(value).includes('room event idempotency conflict'))) process.stderr.write('room-event-idempotency-conflict\n')
    if (message.type === 'error') process.stderr.write(message.args.map(value => value instanceof Error ? value.stack : String(value)).join(' ') + '\n')
  } })
  class FixtureAdapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: 'Collaboration fixture' } }
    listModels(provider) { return Promise.resolve([{ provider, id: 'deepseek-v4-flash', name: 'Fixture' }]) }
    resolveModel(provider, id) { return Promise.resolve({ provider, id, name: 'Fixture', contextWindow: 128000 }) }
    async *stream(options) {
      const userIndex = options.messages.findLastIndex(message => message.role === 'user' && message.source?.kind === 'user')
      const user = options.messages[userIndex]
      const textInput = user?.content.filter(block => block.type === 'text').map(block => block.text).join('') ?? ''
      if (textInput.endsWith('Fixture handoff request.') && !options.messages.slice(userIndex).some(message => message.role === 'tool')) {
        const sourceEventId = user.source.rpcId
        const callId = `fixture-handoff-${sourceEventId}`
        const args = JSON.stringify({ sourceEventId, content: 'Reviewer, finish the shared task.',
          taskId: 'fixture-shared-task', targetEmployeeId: 'fixture-reviewer', idempotencyKey: sourceEventId })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: callId, name: 'room_handoff', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'room_handoff', arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const text = textInput.endsWith('Draft fixture release notes for v1.2.3.')
        ? 'Fixture release notes draft for v1.2.3.' : 'Collaboration fixture completed the request.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.effect(() => ctx.llm.registerAdapter(['deepseek-official'], new FixtureAdapter()), 'collaboration fixture model')
  const stop = message => { if (message === 'stop') process.emit('SIGTERM') }
  ctx.effect(() => {
    process.on('message', stop)
    return () => { process.off('message', stop) }
  })
  void ctx.loader.await().then(async () => {
    const actor = { userId: 'bootstrap-admin', orgId: 'collaboration-fixture', roles: ['administrator'] }
    await ctx.get('enterpriseRequestContext').run(actor, async () => {
      for (const [presetId, name] of [['fixture-assistant', 'Assistant'], ['fixture-reviewer', 'Reviewer']]) {
        const draft = await ctx.get('enterpriseEmployeeController').saveDraft({ presetId, expectedRevision: 0,
          idempotencyKey: `${presetId}-draft`, visibility: 'organization',
          profile: { name, prompt: 'Help the team complete its current request.' }, bindings: [] })
        await ctx.get('enterpriseEmployeeController').publish({ presetId, expectedRevision: draft.revision,
          idempotencyKey: `${presetId}-publish` })
      }
    })
    const identity = ctx.get('enterprisePostgres').identity
    await identity.saveDepartment({ id: 'fixture-team', orgId: actor.orgId, parentId: null,
      name: 'Fixture team', sortOrder: 0, expectedRevision: 0 })
    const user = await identity.findUser(actor.orgId, 'admin')
    await identity.setUserDepartments({ orgId: actor.orgId, userId: actor.userId,
      departmentIds: ['fixture-team'], primaryDepartmentId: 'fixture-team', expectedRevision: user.departmentRevision })
    const workspace = await ctx.get('workspaceRegistry').create(config.workspaceRoot, 'Shared fixture Workspace')
    await identity.saveWorkspaceGrant({ workspaceId: workspace.id, orgId: actor.orgId,
      name: 'Shared fixture Workspace', kind: 'department', departmentId: 'fixture-team',
      rootPath: workspace.path, sandboxMode: 'workspace-write', expectedRevision: 0 })
    process.send({ type: 'ready', url: ctx.get('connection').authenticatedUrl(`http://127.0.0.1:${ctx.get('webServer').port}`),
      workspaceId: workspace.id, employees: ['fixture-assistant', 'fixture-reviewer'] })
  }).catch(error => { process.send({ type: 'failed', error: String(error) }) })
}

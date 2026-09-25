import { describe, expect, it } from 'vitest'
import { parseCollaborationConfig } from '../src/collaboration.ts'

describe('collaboration stored configuration', () => {
  it('preserves published employee references and ordered duty routing', () => {
    const value = { workspaceId: 'shared', memberEmployeeIds: ['support'], dutyEmployeeIds: ['support'], topicPolicy: 'thread', respondPolicy: 'mention_duty' }
    expect(parseCollaborationConfig(value)).toEqual(value)
  })
  it('rejects incomplete or malformed persisted routing instead of inventing defaults', () => {
    for (const value of [null, {}, { workspaceId: 'shared', memberEmployeeIds: [1], dutyEmployeeIds: [] },
      { workspaceId: 'shared', memberEmployeeIds: [], dutyEmployeeIds: [], topicPolicy: 'guess' }]) {
      expect(() => parseCollaborationConfig(value)).toThrow()
    }
  })
})

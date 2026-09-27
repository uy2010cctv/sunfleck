import { describe, expect, it } from 'vitest'
import { parseCollaborationConfig } from '../src/collaboration.ts'

describe('collaboration stored configuration', () => {
  it('preserves published employee references and ordered duty routing', () => {
    const value = { workspaceId: 'shared', memberEmployeeIds: ['support'], dutyEmployeeIds: ['support'], topicPolicy: 'thread', respondPolicy: 'mention_duty' }
    expect(parseCollaborationConfig(value)).toEqual(value)
  })
  it('preserves the group administrator and announcement beside the routing choices', () => {
    const value = { workspaceId: 'shared', memberEmployeeIds: ['support'], dutyEmployeeIds: [], adminUserId: 'alice', announcement: '评审周五' }
    expect(parseCollaborationConfig(value)).toEqual(value)
  })
  it('rejects incomplete or malformed persisted routing instead of inventing defaults', () => {
    for (const value of [null, {}, { workspaceId: 'shared', memberEmployeeIds: [1], dutyEmployeeIds: [] },
      { workspaceId: 'shared', memberEmployeeIds: [], dutyEmployeeIds: [], topicPolicy: 'guess' }]) {
      expect(() => parseCollaborationConfig(value)).toThrow()
    }
  })
  it('rejects malformed group administration state instead of guessing an administrator', () => {
    for (const value of [
      { workspaceId: 'shared', memberEmployeeIds: [], dutyEmployeeIds: [], adminUserId: '' },
      { workspaceId: 'shared', memberEmployeeIds: [], dutyEmployeeIds: [], adminUserId: 7 },
      { workspaceId: 'shared', memberEmployeeIds: [], dutyEmployeeIds: [], announcement: '' },
      { workspaceId: 'shared', memberEmployeeIds: [], dutyEmployeeIds: [], announcement: true },
    ]) {
      expect(() => parseCollaborationConfig(value)).toThrow()
    }
  })
})

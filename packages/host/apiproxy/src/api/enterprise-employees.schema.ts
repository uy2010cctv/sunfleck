import { z } from 'zod'

const id = z.string().min(1)
const write = { expectedRevision: z.number().int().nonnegative(), idempotencyKey: id }
const assetKind = z.enum(['sop', 'knowledge', 'skill', 'tool', 'model'])
const visibility = z.enum(['organization', 'private', 'restricted'])
const ref = z.object({ kind: assetKind, assetId: id, version: z.number().int().positive() }).strict()
export const enterpriseEmployeeDraftValueSchema = z.object({
  presetId: id, orgId: id, ownerUserId: id, visibility, profile: z.record(z.string(), z.unknown()), bindings: z.array(ref),
  revision: z.number().int().positive(), status: z.enum(['draft', 'published']), updatedAt: z.number(),
})
export const enterpriseEmployeeReleaseValueSchema = z.object({
  releaseId: id, presetId: id, orgId: id, version: z.number().int().positive(), digest: id,
  snapshot: z.object({ profile: z.record(z.string(), z.unknown()), bindings: z.array(ref) }),
  publishedBy: id, publishedAt: z.number(), sourceReleaseId: id.optional(),
})
export const enterpriseEmployeeListRequestSchema = z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: id.optional(), search: z.string().optional(), status: z.enum(['draft', 'published']).optional(), ownerUserId: id.optional(), visibility: visibility.optional() }).strict()
export const enterpriseEmployeeListValueSchema = z.object({ items: z.array(enterpriseEmployeeDraftValueSchema), nextCursor: id.optional() })
export const enterpriseEmployeeGetDraftRequestSchema = z.object({ presetId: id }).strict()
export const enterpriseEmployeeSaveDraftRequestSchema = z.object({ presetId: id, ...write, visibility, profile: z.record(z.string(), z.unknown()), bindings: z.array(ref) }).strict()
export const enterpriseEmployeePublishRequestSchema = z.object({ presetId: id, ...write }).strict()
export const enterpriseEmployeeListReleasesRequestSchema = z.object({ presetId: id }).strict()
export const enterpriseEmployeeListReleasesValueSchema = z.array(enterpriseEmployeeReleaseValueSchema)
export const enterpriseEmployeeRollbackRequestSchema = z.object({ presetId: id, releaseId: id, ...write }).strict()

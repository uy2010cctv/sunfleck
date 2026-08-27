import { z } from 'zod'

const id = z.string().min(1)
const kind = z.enum(['sop', 'knowledge', 'skill', 'tool', 'model'])
const write = { expectedRevision: z.number().int().nonnegative(), idempotencyKey: id }
export const enterpriseAssetValueSchema = z.object({ assetId: id, orgId: id, kind, name: id, revision: z.number().int().positive(), archived: z.boolean(), updatedAt: z.number() })
export const enterpriseAssetVersionValueSchema = z.object({ assetId: id, version: z.number().int().positive(), content: z.record(z.string(), z.unknown()), createdBy: id, createdAt: z.number() })
export const enterpriseAssetListRequestSchema = z.object({ limit: z.number().int().min(1).max(100).optional(), cursor: id.optional(), search: z.string().optional(), kind: kind.optional(), archived: z.boolean().optional() }).strict()
export const enterpriseAssetListValueSchema = z.object({ items: z.array(enterpriseAssetValueSchema), nextCursor: id.optional() })
export const enterpriseAssetGetRequestSchema = z.object({ assetId: id }).strict()
export const enterpriseAssetSaveVersionRequestSchema = z.object({ assetId: id, kind, name: id, content: z.record(z.string(), z.unknown()), ...write }).strict()
export const enterpriseAssetListVersionsRequestSchema = z.object({ assetId: id }).strict()
export const enterpriseAssetListVersionsValueSchema = z.array(enterpriseAssetVersionValueSchema)
export const enterpriseAssetArchiveRequestSchema = z.object({ assetId: id, ...write }).strict()

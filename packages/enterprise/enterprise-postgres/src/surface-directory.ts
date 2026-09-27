/** PostgreSQL directory of enterprise collaboration surfaces for the Web project roster. */

import type { EnterprisePostgresDatabase } from './index.ts'

/** Surface kinds the directory admits. */
export type SurfaceDirectoryKind = 'dm' | 'group' | 'channel'

/** Governance fields the project roster may expose. */
export type SurfaceDirectoryEntry =
  | { readonly id: string; readonly kind: 'dm'; readonly memberCount: 0 }
  | { readonly id: string; readonly kind: 'group' | 'channel'; readonly name: string; readonly memberCount: number }

/** Create the versioned directory alongside the PostgreSQL identity schema.
 * @param database - Shared enterprise PostgreSQL handle.
 * @returns After the directory schema has been committed.
 */
export async function migrateSurfaceDirectory(database: EnterprisePostgresDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock($1)', [0x44535344])
    await transaction.query('CREATE TABLE IF NOT EXISTS dsh_enterprise_surface_directory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    await transaction.query(`CREATE TABLE IF NOT EXISTS dsh_enterprise_surface_directory (
      surface_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('dm','group','channel')),
      name TEXT,
      member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count >= 0),
      created_at BIGINT NOT NULL,
      CHECK ((kind = 'dm' AND name IS NULL AND member_count = 0)
        OR (kind IN ('group','channel') AND name IS NOT NULL AND length(trim(name)) > 0))
    )`)
    // Idempotent: archived rooms keep their content but leave the active lists.
    await transaction.query('ALTER TABLE dsh_enterprise_surface_directory ADD COLUMN IF NOT EXISTS archived_at BIGINT')
    await transaction.query(
      'CREATE INDEX IF NOT EXISTS dsh_enterprise_surface_directory_org_created_idx '
      + 'ON dsh_enterprise_surface_directory(org_id, created_at, surface_id)',
    )
    const result = await transaction.query<{ value: string }>(
      "SELECT value FROM dsh_enterprise_surface_directory_meta WHERE key = 'schema-version'",
    )
    if (result.rows[0] === undefined) {
      await transaction.query("INSERT INTO dsh_enterprise_surface_directory_meta(key,value) VALUES ('schema-version','1')")
    } else if (result.rows[0].value !== '1') {
      throw new Error(`enterprise surface directory schema version ${result.rows[0].value} is not supported`)
    }
  })
}

/** Read-only PostgreSQL surface directory; delivery remains owned by the full surface service. */
export class PostgresSurfaceDirectory {
  /** @param database - Shared enterprise PostgreSQL handle. */
  constructor(private readonly database: EnterprisePostgresDatabase) {}

  /** List one organization's stored governance rows, optionally filtered by kind.
   * @param orgId - Organization whose rows may be returned.
   * @param kind - Optional surface-kind filter.
   * @returns Stored rows in creation order.
   */
  async list(orgId: string, kind?: SurfaceDirectoryKind): Promise<readonly SurfaceDirectoryEntry[]> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT surface_id,kind,name,member_count FROM dsh_enterprise_surface_directory
       WHERE org_id=$1 AND ($2::text IS NULL OR kind=$2) ORDER BY created_at,surface_id`,
      [orgId, kind ?? null],
    )
    return result.rows.map((row) => {
      const id = row['surface_id']
      const kind = row['kind']
      const name = row['name']
      const memberCount = row['member_count']
      if (typeof id !== 'string' || typeof memberCount !== 'number' || !Number.isInteger(memberCount)
        || memberCount < 0) throw new Error('invalid enterprise surface directory row')
      if (kind === 'dm' && memberCount === 0) return { id, kind, memberCount: 0 }
      if ((kind === 'group' || kind === 'channel') && typeof name === 'string' && name.trim() !== '') {
        return { id, kind, name, memberCount }
      }
      throw new Error(`invalid enterprise surface directory row ${id}`)
    })
  }
}

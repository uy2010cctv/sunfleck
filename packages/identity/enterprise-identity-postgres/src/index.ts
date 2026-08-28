/** PostgreSQL-backed persistence and safe SQLite migration for DSH enterprise identity. */

export { PgEnterpriseIdentityRepository } from './repository.ts'
export {
  migrateSqliteEnterpriseIdentityToPostgres,
  type EnterpriseIdentityMigrationReport,
  type EnterpriseIdentityMigrationSummary,
  type MigrationTableSummary,
  type SqliteToPostgresMigrationOptions,
} from './migration.ts'
export {
  ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION,
  migrateEnterpriseIdentityPostgres,
} from './schema.ts'
export type { PostgresDatabase, PostgresQueryResult } from './types.ts'

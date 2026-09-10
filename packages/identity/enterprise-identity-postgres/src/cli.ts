/** Command-line entry point for one-shot SQLite to PostgreSQL identity migration. */

import { Pool } from 'pg'
import { migrateSqliteEnterpriseIdentityToPostgres } from './migration.ts'

interface CliOptions {
  readonly sqliteFilename: string
  readonly databaseUrl: string
  readonly backupFilename: string | undefined
  readonly dryRun: boolean
  readonly targetBackupConfirmed: boolean
  readonly sourceQuiesced: boolean
}

function parseOptions(argv: readonly string[]): CliOptions {
  let sqliteFilename: string | undefined
  let databaseUrl: string | undefined
  let backupFilename: string | undefined
  let dryRun = false
  let targetBackupConfirmed = false
  let sourceQuiesced = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') dryRun = true
    else if (argument === '--target-backup-confirmed') targetBackupConfirmed = true
    else if (argument === '--source-quiesced') sourceQuiesced = true
    else if (argument === '--sqlite') sqliteFilename = argv[index + 1]
    else if (argument === '--database-url') databaseUrl = argv[index + 1]
    else if (argument === '--backup') backupFilename = argv[index + 1]
    else throw new Error(`unknown migration argument: ${argument}`)
    if (argument === '--sqlite' || argument === '--database-url' || argument === '--backup') index += 1
  }
  if (sqliteFilename === undefined || databaseUrl === undefined) {
    throw new Error('usage: dsh-enterprise-identity-migrate --sqlite <identity.sqlite> --database-url <postgres-url> [--backup <backup.sqlite>] [--dry-run | --source-quiesced --target-backup-confirmed]')
  }
  if (!dryRun && !targetBackupConfirmed) {
    throw new Error('refusing to write PostgreSQL without --target-backup-confirmed')
  }
  if (!dryRun && !sourceQuiesced) throw new Error('refusing to copy SQLite without --source-quiesced')
  return { sqliteFilename, databaseUrl, backupFilename, dryRun, targetBackupConfirmed, sourceQuiesced }
}

/** Runs the migration CLI and writes only counts/checksums, never database secrets or tokens.
 * @param argv - Input value used by this API.
 * @param write - Input value used by this API.
 */
export async function runMigrationCli(argv: readonly string[], write: (line: string) => void = console.log): Promise<void> {
  const options = parseOptions(argv)
  if (options.dryRun) {
    const report = await migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: options.sqliteFilename,
      target: { query() { return Promise.reject(new Error('dry run must not query PostgreSQL')) } },
      dryRun: true,
    })
    write(JSON.stringify(report))
    return
  }
  const pool = new Pool({ connectionString: options.databaseUrl })
  try {
    const report = await migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: options.sqliteFilename,
      target: pool,
      ...(options.backupFilename === undefined ? {} : { backupFilename: options.backupFilename }),
      targetBackupConfirmed: options.targetBackupConfirmed,
      sourceQuiesced: options.sourceQuiesced,
    })
    write(JSON.stringify(report))
  } finally {
    await pool.end()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrationCli(process.argv.slice(2))
}

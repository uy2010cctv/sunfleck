/** Minimal driver-neutral PostgreSQL surface used by the enterprise adapter. */

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number | null
}

/** Data used by `PostgresDatabase`. */
export interface PostgresDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>
  connect?(): Promise<PostgresDatabase>
  release?(): void
  end?(): Promise<void>
}

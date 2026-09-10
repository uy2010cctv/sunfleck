/** Driver-neutral asynchronous PostgreSQL primitives used by session storage. */

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  /** Rows returned by a PostgreSQL query, typed by the caller's selected shape. */
  readonly rows: readonly Row[]
  /** Number of affected rows, or null when the PostgreSQL driver does not report it. */
  readonly rowCount: number | null
}

/** Data used by `PostgresQueryable`. */
export interface PostgresQueryable {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>
}

/** A database that can execute one callback under one PostgreSQL transaction. */
export interface PostgresDatabase extends PostgresQueryable {
  transaction<T>(action: (transaction: PostgresQueryable) => Promise<T>): Promise<T>
  end?(): Promise<void>
}

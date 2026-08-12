import pg from "pg";
import type { DatabaseClient, DatabaseQuery, DatabaseQueryResult } from "./types.js";

export interface PostgresClient extends DatabaseClient {
  close(): Promise<void>;
  ready(): Promise<boolean>;
}

export interface PostgresClientOptions {
  /** Defaults to true. The audit-only login may disable it to call its one bounded writer function. */
  readOnly?: boolean;
}

export function createPostgresClient(connectionString: string, options: PostgresClientOptions = {}): PostgresClient {
  if (!connectionString) throw new Error("PostgreSQL connection string is required");
  const readOnly = options.readOnly ?? true;
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 3_000,
    allowExitOnIdle: true,
  });
  return {
    async query<T>(query: DatabaseQuery<T>): Promise<DatabaseQueryResult<T>> {
      if (query.signal?.aborted) throw new Error("database query aborted");
      const client = await pool.connect();
      try {
        await client.query(readOnly ? "begin read only" : "begin");
        await client.query("select set_config('statement_timeout', $1, true)", [`${query.timeoutMs}ms`]);
        await client.query("select set_config('lock_timeout', $1, true)", ["1000ms"]);
        const result = await client.query<Record<string, unknown>>(query.text, [...query.values]);
        if (result.rows.length > query.maxRows) throw new Error("database returned more rows than allowed");
        await client.query("commit");
        return { rows: result.rows as T[], rowCount: result.rowCount ?? result.rows.length };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async ready() {
      try {
        const result = await pool.query<{ ready: number }>("select 1 as ready from opendesign_admin_read.database_sync limit 1");
        return result.rows[0]?.ready === 1;
      } catch { return false; }
    },
    async close() { await pool.end(); },
  };
}

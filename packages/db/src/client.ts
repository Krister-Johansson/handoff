import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

// Builder queries only. Relational `db.query` is deliberately not configured (see docs/plan.md).
export type Db = NodePgDatabase & { $client: pg.Pool };

/**
 * A database on a connection pool. When Postgres drops an idle connection (a restart, a terminated
 * backend), the pool emits an error; without a listener Node treats it as uncaught and the process
 * exits. The pool already discards that connection and the next query opens a new one, so the error is
 * only reported, to `onError` or as a warning.
 */
export function createDb(connectionString: string, { onError }: { onError?: (error: Error) => void } = {}): Db {
  const pool = new pg.Pool({ connectionString });
  pool.on("error", onError ?? ((error) => console.warn(`postgres: idle connection lost: ${error.message}`)));
  return drizzle({ client: pool });
}

export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the pool-backed database or an open transaction. */
export type DbExecutor = Db | DbTx;

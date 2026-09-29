import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

// Builder queries only. Relational `db.query` is deliberately not configured (see docs/plan.md).
export type Db = NodePgDatabase & { $client: pg.Pool };

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return drizzle({ client: pool });
}

export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the pool-backed database or an open transaction. */
export type DbExecutor = Db | DbTx;

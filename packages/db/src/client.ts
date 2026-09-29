import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

// Builder queries only. Relational `db.query` is deliberately not configured (see docs/plan.md).
export type Db = NodePgDatabase & { $client: pg.Pool };

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return drizzle({ client: pool });
}

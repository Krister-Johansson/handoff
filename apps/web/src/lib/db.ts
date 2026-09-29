import "server-only";
import { createDb, type Db } from "@handoff/db";

const globalForDb = globalThis as unknown as { handoffDb?: Db };

/** One pool per server process, reused across dev hot reloads. */
export function getDb(): Db {
  if (!globalForDb.handoffDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForDb.handoffDb = createDb(url);
  }
  return globalForDb.handoffDb;
}

import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import type { Db } from "./client.ts";

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder });
}

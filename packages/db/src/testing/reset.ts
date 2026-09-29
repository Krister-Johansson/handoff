import type { Db } from "../client.ts";

/** Drops every table, type and the drizzle migrations schema. Test databases only. */
export async function dropAllTables(db: Db): Promise<void> {
  await db.$client.query("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
}

/** Truncates all application tables between tests. */
export async function truncateAll(db: Db): Promise<void> {
  const { rows } = await db.$client.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  await db.$client.query(`truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`);
}

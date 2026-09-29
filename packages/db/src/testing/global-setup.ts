import { createDb } from "../client.ts";
import { runMigrations } from "../migrate.ts";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://handoff:handoff@localhost:5433/handoff_test";
  process.env.TEST_DATABASE_URL = url;
  const db = createDb(url);
  try {
    await db.$client.query("select 1");
  } catch (error) {
    await db.$client.end().catch(() => {});
    throw new Error(`Postgres is not reachable at ${url}. Run \`pnpm db:up\` first.\n${String(error)}`);
  }
  await runMigrations(db);
  await db.$client.end();
}

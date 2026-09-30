import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { dropAllTables } from "./testing/reset.ts";

const url = process.env.TEST_DATABASE_URL ?? "postgres://handoff:handoff@localhost:5433/handoff_test";

describe("migrations", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(url);
    await dropAllTables(db);
  });

  afterAll(async () => {
    await runMigrations(db);
    await db.$client.end();
  });

  test("migrations apply to an empty database and are idempotent", async () => {
    await runMigrations(db);
    await runMigrations(db);

    const tables = await db.$client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "edge_traversals",
      "events",
      "github_installations",
      "graph_versions",
      "graphs",
      "library_agents",
      "library_groups",
      "library_mcp_servers",
      "library_skills",
      "node_executions",
      "projects",
      "questions",
      "runs",
      "webhook_deliveries",
      "workers",
    ]);
  });
});

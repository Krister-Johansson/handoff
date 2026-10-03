import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createDb, type Db } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { dropAllTables } from "./testing/reset.ts";
import { testDatabaseUrl } from "./testing/test-db.ts";

describe("migrations", () => {
  let db: Db;

  beforeAll(async () => {
    db = createDb(testDatabaseUrl());
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
      "assistant_conversations",
      "assistant_messages",
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
      "notification_reads",
      "notifications",
      "permission_requests",
      "plan_pins",
      "previews",
      "project_schedulers",
      "projects",
      "questions",
      "review_views",
      "runs",
      "scheduler_events",
      "screenshots",
      "webhook_deliveries",
      "workers",
    ]);
  });
});

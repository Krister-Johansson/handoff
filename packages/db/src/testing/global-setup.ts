import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb } from "../client.ts";
import { runMigrations } from "../migrate.ts";

/** The part of Vitest's TestProject the setup uses. */
interface Provider {
  provide(key: "testDatabaseUrl", value: string): void;
}

/**
 * Integration global setup. Uses TEST_DATABASE_URL when it is set; otherwise starts a Postgres container
 * for this run (Ryuk removes it if the run crashes). Migrates the database, provides its URL to the tests
 * and returns the teardown that stops the container.
 */
export default async function setup(project: Provider): Promise<() => Promise<void>> {
  let container: StartedPostgreSqlContainer | undefined;
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    try {
      container = await new PostgreSqlContainer("postgres:17-alpine")
        .withDatabase("handoff_test")
        .withUsername("handoff")
        .withPassword("handoff")
        .start();
    } catch (error) {
      throw new Error(`Could not start a Postgres container for the integration tests. Is Docker running? Or set TEST_DATABASE_URL.\n${String(error)}`);
    }
    url = container.getConnectionUri();
  }
  const stop = async () => {
    await container?.stop();
  };
  const db = createDb(url);
  try {
    await db.$client.query("select 1");
    await runMigrations(db);
  } catch (error) {
    await stop();
    throw new Error(`Could not migrate the integration test database at ${url}.\n${String(error)}`);
  } finally {
    await db.$client.end().catch(() => {});
  }
  project.provide("testDatabaseUrl", url);
  return stop;
}

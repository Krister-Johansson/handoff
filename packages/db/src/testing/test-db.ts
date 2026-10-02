import { inject } from "vitest";
import { createDb, type Db } from "../client.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** The integration suite's database: TEST_DATABASE_URL when set, otherwise a Postgres container started for this run. */
    testDatabaseUrl: string;
  }
}

/** The database the integration global setup migrated: TEST_DATABASE_URL, or the Postgres container it started. */
export function testDatabaseUrl(): string {
  const url = inject("testDatabaseUrl") ?? process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("No test database. Integration tests get one from packages/db/src/testing/global-setup.ts.");
  return url;
}

/** One pool per test file. Schema is migrated by the integration global setup. */
export function createTestDb(): Db {
  return createDb(testDatabaseUrl());
}

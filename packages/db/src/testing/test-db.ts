import { createDb, type Db } from "../client.ts";

export const testDatabaseUrl = () => process.env.TEST_DATABASE_URL ?? "postgres://handoff:handoff@localhost:5433/handoff_test";

/** One pool per test file. Schema is migrated by the integration global setup. */
export function createTestDb(): Db {
  return createDb(testDatabaseUrl());
}

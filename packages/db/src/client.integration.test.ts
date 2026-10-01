import { expect, test, vi } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "./client.ts";
import { testDatabaseUrl } from "./testing/index.ts";

test("an idle connection that Postgres drops does not crash the process, and the next query reconnects", async () => {
  const onError = vi.fn();
  const db = createDb(testDatabaseUrl(), { onError });
  const killer = createDb(testDatabaseUrl());
  try {
    const [{ pid }] = (await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows as [{ pid: number }];
    // The pool's connection is idle now; ending it from the server side is what a Postgres restart does.
    await killer.execute(sql`select pg_terminate_backend(${pid})`);
    await vi.waitFor(() => expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: expect.stringContaining("terminat") }));
    const { rows } = await db.execute<{ ok: number }>(sql`select 1 as ok`);
    expect(rows).toEqual([{ ok: 1 }]);
  } finally {
    await Promise.all([db.$client.end(), killer.$client.end()]);
  }
});

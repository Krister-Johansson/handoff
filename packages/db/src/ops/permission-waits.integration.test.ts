import { afterAll, beforeEach, expect, test } from "vitest";
import { permissionRequests } from "../schema/index.ts";
import { seedExecution, seedRun } from "../testing/fixtures.ts";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { permissionWaits } from "./permission-waits.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const ask = (runId: string, nodeExecutionId: string, createdAt: Date, status: "pending" | "allowed" = "pending") =>
  db.insert(permissionRequests).values({ id: crypto.randomUUID(), runId, nodeExecutionId, toolName: "Bash", input: { command: "pnpm test" }, status, createdAt });

test("a run whose running step has an open permission request waits on permission, named by the step and the oldest request", async () => {
  const { run } = await seedRun(db);
  const coder = await seedExecution(db, run.id, { nodeKey: "coder", status: "running", waitingOn: "permission" });
  await ask(run.id, coder.id, new Date("2026-10-05T09:00:00Z"));
  await ask(run.id, coder.id, new Date("2026-10-05T09:05:00Z"));

  const waits = await permissionWaits(db, [run.id]);

  expect(waits.get(run.id)).toEqual({ kind: "permission", nodeKey: "coder", since: new Date("2026-10-05T09:00:00Z"), toolName: "Bash", input: { command: "pnpm test" } });
});

test("a run without an open request, or with only decided ones, does not wait on permission", async () => {
  const { run: decided } = await seedRun(db);
  const coder = await seedExecution(db, decided.id, { status: "running" });
  await ask(decided.id, coder.id, new Date(), "allowed");
  const { run: quiet } = await seedRun(db);
  await seedExecution(db, quiet.id, { status: "running" });

  const waits = await permissionWaits(db, [decided.id, quiet.id]);

  expect(waits.size).toBe(0);
});

test("a request left pending on a step that is no longer running does not count", async () => {
  const { run } = await seedRun(db);
  const coder = await seedExecution(db, run.id, { status: "failed" });
  await ask(run.id, coder.id, new Date());

  expect((await permissionWaits(db, [run.id])).size).toBe(0);
});

test("no runs asked for means no query and no waits", async () => {
  expect((await permissionWaits(db, [])).size).toBe(0);
});

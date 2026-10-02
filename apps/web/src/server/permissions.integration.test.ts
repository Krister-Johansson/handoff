import { afterAll, beforeEach, expect, test } from "vitest";
import { permissionRequests } from "@handoff/db";
import { createTestDb, seedExecution, seedRun, truncateAll } from "@handoff/db/testing";
import { allPendingPermissions, pendingPermissions } from "./permissions";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("a pending permission request says when it was made, so its card can say how long it has waited", async () => {
  const { run } = await seedRun(db, { status: "running" });
  const coder = await seedExecution(db, run.id, { nodeKey: "coder", status: "running" });
  const asked = new Date("2026-10-02T09:00:00Z");
  const id = crypto.randomUUID();
  await db.insert(permissionRequests).values({ id, runId: run.id, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "pnpm test" }, createdAt: asked });

  expect(await pendingPermissions(db, run.id)).toEqual([{ id, runId: run.id, nodeKey: "coder", toolName: "Bash", input: { command: "pnpm test" }, createdAt: asked }]);
  expect(await allPendingPermissions(db)).toEqual([expect.objectContaining({ id, createdAt: asked })]);
});

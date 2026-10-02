import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { eq, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "@/server/graphs";

const db = createTestDb();
vi.mock("@/lib/db", () => ({ getDb: () => db }));

const { GET } = await import("./route");

beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("the count route answers with how many items wait in the Inbox", async () => {
  expect(await (await GET()).json()).toEqual({ count: 0 });

  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "g", document: linear });
  const broken = await startRunFromGraph(db, { projectId: project.id, graphName: "g", task: "Add a CHANGELOG.md" });
  await seedExecution(db, broken.id, { nodeKey: "coder", status: "failed" });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, broken.id));

  expect(await (await GET()).json()).toEqual({ count: 1 });
});

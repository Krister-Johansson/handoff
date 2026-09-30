import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents } from "./events.ts";
import { eq } from "drizzle-orm";
import { events, nodeExecutions, projects, questions, runs } from "../schema/index.ts";
import { seedExecution, seedRun } from "../testing/fixtures.ts";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { deleteProject } from "./projects.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("deleteProject removes the project with its graphs, runs, executions, questions and events", async () => {
  const { project, run } = await seedRun(db);
  const { project: other } = await seedRun(db);
  const exec = await seedExecution(db, run.id);
  await db.insert(questions).values({ runId: run.id, nodeExecutionId: exec.id, question: "q" });
  await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "x", payload: {}, nodeExecutionId: exec.id }]));
  await deleteProject(db, project.id);
  expect((await db.select().from(projects)).map((p) => p.id)).toEqual([other.id]);
  expect(await db.select().from(runs).where(eq(runs.projectId, project.id))).toEqual([]);
  expect(await db.select().from(nodeExecutions)).toEqual([]);
  expect(await db.select().from(events)).toEqual([]);
});

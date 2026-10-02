import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents } from "./events.ts";
import { eq } from "drizzle-orm";
import { events, nodeExecutions, notifications, projects, questions, runs } from "../schema/index.ts";
import { seedExecution, seedRun } from "../testing/fixtures.ts";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { createNotification } from "./notifications.ts";
import { deleteProject, setProjectLibrary } from "./projects.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("deleteProject removes the project with its graphs, runs, executions, questions, events and notifications", async () => {
  const { project, run } = await seedRun(db);
  const { project: other, run: otherRun } = await seedRun(db);
  await createNotification(db, { tone: "success", title: "run finished", body: "t", projectId: project.id, runId: run.id });
  await createNotification(db, { tone: "neutral", title: "about the project", body: "", projectId: project.id });
  const kept = await createNotification(db, { tone: "success", title: "run finished", body: "t", projectId: other.id, runId: otherRun.id });
  const exec = await seedExecution(db, run.id);
  await db.insert(questions).values({ runId: run.id, nodeExecutionId: exec.id, question: "q" });
  await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "x", payload: {}, nodeExecutionId: exec.id }]));
  await deleteProject(db, project.id);
  expect((await db.select().from(projects)).map((p) => p.id)).toEqual([other.id]);
  expect(await db.select().from(runs).where(eq(runs.projectId, project.id))).toEqual([]);
  expect(await db.select().from(nodeExecutions)).toEqual([]);
  expect(await db.select().from(events)).toEqual([]);
  expect((await db.select().from(notifications)).map((n) => n.id)).toEqual([kept.id]);
});

test("a project's default library starts empty and keeps the names it is given", async () => {
  const { project } = await seedRun(db);
  expect(project.library).toEqual({ skills: [], mcp: [], agents: [], groups: [] });
  const updated = await setProjectLibrary(db, project.id, { skills: ["tdd"], mcp: ["context7"], agents: [], groups: ["testing"] });
  expect(updated?.library).toEqual({ skills: ["tdd"], mcp: ["context7"], agents: [], groups: ["testing"] });
});

import { afterAll, beforeEach, expect, test } from "vitest";
import { notifications } from "../schema/index.ts";
import { seedRun } from "../testing/fixtures.ts";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { createNotification } from "./notifications.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("a notification keeps the tone, title, body and link its sender gave it, with the project and run it is about", async () => {
  const { project, run } = await seedRun(db);
  const told = await createNotification(db, { tone: "attention", title: "sandbox: gate asks a question", body: "Which license?", href: `/projects/${project.id}/runs/${run.id}`, projectId: project.id, runId: run.id });
  expect(await db.select().from(notifications)).toEqual([
    { id: told.id, projectId: project.id, runId: run.id, tone: "attention", title: "sandbox: gate asks a question", body: "Which license?", href: `/projects/${project.id}/runs/${run.id}`, createdAt: expect.any(Date) },
  ]);
});

test("a notification needs no link, project or run", async () => {
  await createNotification(db, { tone: "neutral", title: "The worker restarted", body: "" });
  expect(await db.select().from(notifications)).toMatchObject([{ tone: "neutral", title: "The worker restarted", body: "", href: null, projectId: null, runId: null }]);
});

test("a notification written in a transaction that fails is not kept", async () => {
  await expect(
    db.transaction(async (tx) => {
      await createNotification(tx, { tone: "danger", title: "sandbox: run failed", body: "Add a CHANGELOG.md" });
      throw new Error("the run's end did not commit");
    }),
  ).rejects.toThrow("did not commit");
  expect(await db.select().from(notifications)).toEqual([]);
});

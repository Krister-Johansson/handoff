import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projectSchedulers, sql } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { seedGraph } from "../testing/harness.ts";
import { nudgeScheduler } from "./nudge.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

/** A project's scheduler whose last check was `ago` seconds back and whose next check is `next` seconds away. */
async function scheduler(opts: { ago: number; next: number; enabled?: boolean }) {
  const { project } = await seedGraph(db, linear);
  await db.insert(projectSchedulers).values({
    projectId: project.id,
    enabled: opts.enabled ?? true,
    graphName: "g",
    lastCheckAt: sql`now() - make_interval(secs => ${opts.ago})`,
    nextCheckAt: sql`now() + make_interval(secs => ${opts.next})`,
  });
  /** Seconds from now to the next check, rounded. */
  const due = async () => {
    const [row] = await db
      .select({ s: sql<number>`round(extract(epoch from ${projectSchedulers.nextCheckAt} - now()))::int` })
      .from(projectSchedulers)
      .where(eq(projectSchedulers.projectId, project.id));
    return row!.s;
  };
  return { projectId: project.id, due };
}

test("a nudge brings the next check to now, never closer than 10 seconds after the last check, and only while the scheduler is on", async () => {
  const long = await scheduler({ ago: 30, next: 30 });
  const recent = await scheduler({ ago: 4, next: 56 });
  const soon = await scheduler({ ago: 58, next: -1 });
  const off = await scheduler({ ago: 30, next: 30, enabled: false });

  for (const s of [long, recent, soon, off]) await nudgeScheduler(db, s.projectId);

  expect(await long.due()).toBe(0);
  expect(await recent.due()).toBe(6);
  // A check already due stays due.
  expect(await soon.due()).toBe(-1);
  expect(await off.due()).toBe(30);
});

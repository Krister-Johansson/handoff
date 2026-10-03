import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { createProject } from "./graphs";
import { planViewRefusal } from "./plan-mode";

const db = createTestDb();
let projectId: string;

beforeEach(async () => {
  await truncateAll(db);
  projectId = (await createProject(db, { name: "todooverkill", repo: "octo/todooverkill", defaultBranch: "main" })).id;
});
afterAll(() => db.$client.end());

test("go_to_plan with the other mode's view is refused on the server, where the project's mode is known", async () => {
  expect(await planViewRefusal(db, "go_to_plan", { project_id: projectId, view: "timeline" })).toBe(
    "todooverkill plans in Flow mode, so its Plan page shows Flow, not a timeline. Use go_to_plan with view flow.",
  );
  expect(await planViewRefusal(db, "go_to_plan", { project_id: projectId, view: "flow" })).toBeUndefined();
  await db.update(projects).set({ planMode: "timeline" }).where(eq(projects.id, projectId));
  expect(await planViewRefusal(db, "go_to_plan", { project_id: projectId, view: "flow" })).toBe(
    "todooverkill plans in Timeline mode, so its Plan page shows a timeline, not Flow. Use go_to_plan with view timeline.",
  );
  // Another tool, a project id that is not one and an unknown project pass to the page as before.
  expect(await planViewRefusal(db, "go_to_run", { run_id: "r1" })).toBeUndefined();
  expect(await planViewRefusal(db, "go_to_plan", { project_id: "p1", view: "flow" })).toBeUndefined();
  expect(await planViewRefusal(db, "go_to_plan", { project_id: crypto.randomUUID(), view: "flow" })).toBeUndefined();
});

import { afterAll, beforeEach, expect, test } from "vitest";
import { projects, webhookDeliveries } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { lastGitHubActivity } from "./plan-activity.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function project(repoId: number | null) {
  const [row] = await db
    .insert(projects)
    .values({ name: `p-${crypto.randomUUID()}`, repoOwner: "octo", repoName: "sample", defaultBranch: "main", repoId })
    .returning();
  return row!;
}

let delivery = 0;
async function deliver(eventName: string, repoId: number, at: string, payload: Record<string, unknown>) {
  await db.insert(webhookDeliveries).values({
    deliveryId: `d-${++delivery}`,
    eventName,
    action: typeof payload.action === "string" ? payload.action : null,
    repoId,
    payload: { ...payload, repository: { id: repoId } },
    receivedAt: new Date(at),
  });
}

test("the activity line shows the latest issues, sub_issues or issue_dependencies delivery for the repository", async () => {
  const { id } = await project(42);
  await deliver("issues", 42, "2026-10-02T10:00:00Z", { action: "labeled", issue: { number: 57 } });
  await deliver("sub_issues", 42, "2026-10-02T10:05:00Z", { action: "sub_issue_added", parent_issue: { number: 41 }, sub_issue: { number: 58 } });
  await deliver("check_suite", 42, "2026-10-02T10:10:00Z", { action: "completed" });
  await deliver("issues", 99, "2026-10-02T10:15:00Z", { action: "opened", issue: { number: 3 } });

  expect(await lastGitHubActivity(db, id)).toEqual({
    event: "sub_issues",
    action: "sub_issue_added",
    issue: 58,
    summary: "#58 added as a sub-issue of #41",
    receivedAt: new Date("2026-10-02T10:05:00Z"),
  });

  await deliver("issue_dependencies", 42, "2026-10-02T10:20:00Z", { action: "blocked_by_added", blocked_issue: { number: 57 }, blocking_issue: { number: 55 } });
  expect(await lastGitHubActivity(db, id)).toMatchObject({ event: "issue_dependencies", issue: 57, summary: "#57 marked blocked by #55" });

  await deliver("issues", 42, "2026-10-02T10:25:00Z", { action: "closed", issue: { number: 57 } });
  expect(await lastGitHubActivity(db, id)).toMatchObject({ event: "issues", issue: 57, summary: "Issue #57 closed" });
});

test("the activity line reads a removed sub-issue or blocker as a removal", async () => {
  const { id } = await project(42);
  await deliver("sub_issues", 42, "2026-10-02T10:00:00Z", { action: "sub_issue_removed", parent_issue: { number: 41 }, sub_issue: { number: 58 } });
  expect(await lastGitHubActivity(db, id)).toMatchObject({ issue: 58, summary: "#58 removed as a sub-issue of #41" });
  await deliver("issue_dependencies", 42, "2026-10-02T10:05:00Z", { action: "blocked_by_removed", blocked_issue: { number: 57 }, blocking_issue: { number: 55 } });
  expect(await lastGitHubActivity(db, id)).toMatchObject({ issue: 57, summary: "#57 no longer blocked by #55" });
});

test("the activity line is empty for a project without a repository id or without issue deliveries", async () => {
  const unlinked = await project(null);
  const quiet = await project(42);
  await deliver("check_suite", 42, "2026-10-02T10:00:00Z", { action: "completed" });
  expect(await lastGitHubActivity(db, unlinked.id)).toBeNull();
  expect(await lastGitHubActivity(db, quiet.id)).toBeNull();
});

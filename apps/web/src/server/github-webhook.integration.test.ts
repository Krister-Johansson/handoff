import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, listEventsAfter, nodeExecutions, projects, runs, webhookDeliveries } from "@handoff/db";
import { createTestDb, seedExecution, seedRun, truncateAll } from "@handoff/db/testing";
import { signPayload } from "@handoff/github/testing";
import { handleGitHubWebhook } from "./github-webhook.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const secret = "whsec";
const checkSuite = { action: "completed", repository: { id: 42 }, check_suite: { head_sha: "abc", conclusion: "success", pull_requests: [{ number: 7 }] } };

function request(event: string, payload: unknown, opts: { delivery?: string; signature?: string } = {}) {
  const body = JSON.stringify(payload);
  return new Request("http://localhost/api/webhooks/github", {
    method: "POST",
    body,
    headers: {
      "x-github-event": event,
      "x-github-delivery": opts.delivery ?? "d-1",
      "x-hub-signature-256": opts.signature ?? signPayload(secret, body),
      "content-type": "application/json",
    },
  });
}

test("webhook route returns 401 for a bad signature and stores nothing", async () => {
  const response = await handleGitHubWebhook(db, request("check_suite", checkSuite, { signature: "sha256=" + "0".repeat(64) }), secret);
  expect(response.status).toBe(401);
  expect(await db.select().from(webhookDeliveries)).toEqual([]);
});

test("webhook route answers ping with 200", async () => {
  const response = await handleGitHubWebhook(db, request("ping", { zen: "hi" }), secret);
  expect(response.status).toBe(200);
});

test("webhook route wakes the waiting execution whose wait_key matches and records it on the run", async () => {
  const { run } = await seedRun(db, { status: "waiting" });
  const execution = await seedExecution(db, run.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKey: "gh:pr:42:7" });
  const response = await handleGitHubWebhook(db, request("check_suite", checkSuite), secret);
  expect(response.status).toBe(202);
  const [row] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.id, execution.id));
  expect(row).toMatchObject({ status: "pending", wakeReason: "webhook" });
  const [delivery] = await db.select().from(webhookDeliveries);
  expect(delivery).toMatchObject({ deliveryId: "d-1", eventName: "check_suite", action: "completed", repoId: 42, correlationKeys: ["gh:pr:42:7"] });
  expect(delivery?.wokeExecutionIds).toEqual([execution.id]);
  expect(delivery?.processedAt).not.toBeNull();
  const events = await listEventsAfter(db, run.id, 0, 10);
  expect(events.map((e) => e.type)).toEqual(["github.webhook"]);
  expect(events[0]?.payload).toMatchObject({ event: "check_suite", action: "completed", deliveryId: "d-1" });
});

test("webhook route stores a delivery once and returns 200 on redelivery", async () => {
  await handleGitHubWebhook(db, request("check_suite", checkSuite), secret);
  const again = await handleGitHubWebhook(db, request("check_suite", checkSuite), secret);
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ duplicate: true });
  expect(await db.select().from(webhookDeliveries)).toHaveLength(1);
});

test("webhook route accepts events that match no execution", async () => {
  const response = await handleGitHubWebhook(db, request("push", { repository: { id: 42 } }, { delivery: "d-2" }), secret);
  expect(response.status).toBe(202);
});

test("an issues delivery is stored with its repository id and action", async () => {
  const payload = { action: "labeled", repository: { id: 42 }, issue: { number: 57, title: "Add the migration" }, label: { name: "task" } };
  const response = await handleGitHubWebhook(db, request("issues", payload, { delivery: "d-issues" }), secret);
  expect(response.status).toBe(202);
  const [delivery] = await db.select().from(webhookDeliveries);
  expect(delivery).toMatchObject({ deliveryId: "d-issues", eventName: "issues", action: "labeled", repoId: 42, correlationKeys: [], wokeExecutionIds: [] });
  expect(delivery?.payload).toEqual(payload);
});

test("a check event without pull requests wakes the PR node of the run on that branch", async () => {
  const { run, project } = await seedRun(db, { status: "waiting" });
  await db.update(projects).set({ repoId: 42 }).where(eq(projects.id, project.id));
  await db.update(runs).set({ prNumber: 7, branchName: "handoff/fix-1" }).where(eq(runs.id, run.id));
  const execution = await seedExecution(db, run.id, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKey: "gh:pr:42:7" });
  const payload = { action: "completed", repository: { id: 42 }, check_suite: { head_sha: "abc", head_branch: "handoff/fix-1", pull_requests: [] } };
  const response = await handleGitHubWebhook(db, request("check_suite", payload, { delivery: "d-9" }), secret);
  expect(response.status).toBe(202);
  const [row] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.id, execution.id));
  expect(row?.status).toBe("pending");
});

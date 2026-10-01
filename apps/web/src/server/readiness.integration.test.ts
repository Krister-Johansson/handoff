import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, projects, registerWorker, webhookDeliveries } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createProject, saveGraphVersion } from "./graphs";
import { projectReadiness } from "./readiness";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const launch = JSON.stringify({ version: "0.0.1", configurations: [{ name: "web", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], port: 5173, autoPort: true }] });
const issue = (number: number, body: string) => ({ number, title: `F${number}`, url: `https://github.com/octo/sample/issues/${number}`, body, state: "open" as const, updatedAt: `2026-10-01T10:0${number}:00Z` });

const status = (checks: { id: string; status: string }[]) => Object.fromEntries(checks.map((c) => [c.id, c.status]));

test("a fresh project says what it still needs, and how to fix each thing", async () => {
  const project = await createProject(db, { name: "sample", repo: "octo/sample", defaultBranch: "main" });
  const github = new FakeGitHub();
  github.ciConfigured = false;
  github.issues.set(1, issue(1, "Just a sentence."));
  github.issues.set(2, issue(2, "Another one."));
  const readiness = await projectReadiness(db, github, project.id);
  expect(readiness.ready).toBe(false);
  expect(status(readiness.checks)).toEqual({
    graph: "todo",
    worker: "todo",
    setup_command: "todo",
    claude_md: "todo",
    launch: "todo",
    ci: "todo",
    acceptance: "todo",
    dependencies: "info",
    webhooks: "info",
  });
  const launchCheck = readiness.checks.find((c) => c.id === "launch")!;
  expect(launchCheck.fix).toContain(".claude/launch.json");
  expect(launchCheck.fix).toContain("PORT");
});

test("a project set up for handoff is ready, and says what it found", async () => {
  const project = await createProject(db, { name: "sample", repo: "octo/sample", defaultBranch: "main" });
  await db.update(projects).set({ setupCommand: "pnpm install", repoId: 42 }).where(eq(projects.id, project.id));
  await saveGraphVersion(db, { projectId: project.id, name: "master", document: linear });
  await registerWorker(db, { id: "w1", hostname: "here", caps: { cli: 2, shell: 2, github: 4, human: 1000, function: 4 } });
  await db.insert(webhookDeliveries).values({ deliveryId: "d1", eventName: "check_suite", repoId: 42, payload: {} });
  const github = new FakeGitHub();
  github.ciConfigured = true;
  github.files.set("CLAUDE.md", "# sample");
  github.files.set(".claude/launch.json", launch);
  github.issues.set(1, issue(1, "## Acceptance criteria\n- [ ] A user can sign in"));
  github.issues.set(2, { ...issue(2, "- [ ] Tasks persist"), blockedBy: [1] });
  const readiness = await projectReadiness(db, github, project.id);
  expect(readiness.ready).toBe(true);
  expect(status(readiness.checks)).toEqual({
    graph: "ok",
    worker: "ok",
    setup_command: "ok",
    claude_md: "ok",
    launch: "ok",
    ci: "ok",
    acceptance: "ok",
    dependencies: "ok",
    webhooks: "ok",
  });
  expect(readiness.checks.find((c) => c.id === "launch")!.detail).toContain("web");
  expect(readiness.checks.find((c) => c.id === "acceptance")!.detail).toContain("2 of 2");
});

test("a launch file that does not parse says why", async () => {
  const project = await createProject(db, { name: "sample", repo: "octo/sample", defaultBranch: "main" });
  const github = new FakeGitHub();
  github.files.set(".claude/launch.json", "{ nope");
  const launchCheck = (await projectReadiness(db, github, project.id)).checks.find((c) => c.id === "launch")!;
  expect(launchCheck).toMatchObject({ status: "todo", detail: expect.stringMatching(/not valid JSON/) });
});

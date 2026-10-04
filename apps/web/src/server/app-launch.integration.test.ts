import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, launchTests, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { loadAppLaunch } from "./app-launch";
import { createProject } from "./graphs";

const db = createTestDb();
let projectId: string;
let github: FakeGitHub;

beforeEach(async () => {
  await truncateAll(db);
  github = new FakeGitHub();
  projectId = (await createProject(db, { name: "shop", repo: "octo/shop", defaultBranch: "main" })).id;
});
afterAll(() => db.$client.end());

const launchFile = `{
  // handoff picks handoff-demo
  "configurations": [
    { "name": "web", "runtimeExecutable": "pnpm", "runtimeArgs": ["--filter", "@octo/web", "dev"] },
    { "name": "handoff-demo", "runtimeExecutable": "pnpm", "runtimeArgs": ["start"], "port": 4000, "cwd": "apps/web", "env": { "NODE_ENV": "production" } },
  ],
}`;

test("a repository with a launch file shows it read-only: its configurations, the one handoff starts, and a link to the file", async () => {
  github.files.set(".claude/launch.json", launchFile);
  const view = await loadAppLaunch(db, github, projectId, {});
  expect(view.detected).toEqual({
    kind: "file",
    url: "https://github.com/octo/shop/blob/main/.claude/launch.json",
    configurations: ["web", "handoff-demo"],
    picked: expect.objectContaining({ name: "handoff-demo", runtimeArgs: ["start"], port: 4000, cwd: "apps/web" }),
  });
  expect(view).toMatchObject({ branch: "main", docker: null, saved: null, services: null, seedCommand: null, test: null });
});

test("a launch file handoff cannot read says why, since runs stop there too", async () => {
  github.files.set(".claude/launch.json", `{ "configurations": [{ "port": 3000 }] }`);
  const view = await loadAppLaunch(db, github, projectId, {});
  expect(view.detected).toEqual({ kind: "invalid", url: expect.stringContaining("/blob/main/.claude/launch.json"), error: expect.stringMatching(/name/) });
});

test("without a launch file the saved setting, the compose services and the seed command show", async () => {
  github.files.set("compose.yaml", "services:\n  postgres:\n    image: postgres:17\n  redis:\n    image: redis:7\n");
  const saved = { name: "app", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], args: [], port: 3000, env: {} };
  await db.update(projects).set({ launch: saved, demoSeedCommand: "pnpm db:seed" }).where(eq(projects.id, projectId));
  const view = await loadAppLaunch(db, github, projectId, {});
  expect(view).toMatchObject({ detected: { kind: "none" }, saved, services: { file: "compose.yaml", names: ["postgres", "redis"] }, seedCommand: "pnpm db:seed" });
});

test("without GitHub the file cannot be checked, and the setting still shows", async () => {
  const view = await loadAppLaunch(db, undefined, projectId, {});
  expect(view).toMatchObject({ detected: { kind: "unknown" }, services: undefined });
});

test("the worker's Docker workspace mode is known, and the latest Test start shows with its steps", async () => {
  const stopsAt = new Date(Date.now() + 60_000);
  await db.insert(launchTests).values({
    projectId,
    command: "pnpm dev",
    status: "failed",
    error: "The app exited with code 1 before it was up:",
    log: "Cannot find module vite",
    steps: [{ name: "app", status: "failed", detail: "Exited with code 1", ms: 1200 }],
    stopsAt,
  });
  const view = await loadAppLaunch(db, github, projectId, { HANDOFF_WORKSPACE: "docker", HANDOFF_DOCKER_IMAGE: "runner:1" }, async () => "27.5.1");
  // The image the containers come from and the Engine's version, for the section's copy and its warning.
  expect(view.docker).toEqual({ image: "runner:1", engine: "27.5.1" });
  expect(view.test).toMatchObject({
    status: "failed",
    command: "pnpm dev",
    error: "The app exited with code 1 before it was up:",
    log: "Cannot find module vite",
    steps: [{ name: "app", status: "failed", detail: "Exited with code 1", ms: 1200 }],
    stopsAt: stopsAt.toISOString(),
  });
});

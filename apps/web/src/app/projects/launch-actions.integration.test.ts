import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { eq, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import type { LaunchForm } from "@handoff/core";
import { createProject } from "@/server/graphs";

const db = createTestDb();
const env = vi.hoisted(() => ({ revalidated: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => void env.revalidated.push(path) }));
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/github", () => ({ getGitHub: () => undefined }));

const { launchTestAction, saveAppLaunchAction, startLaunchTestAction, stopLaunchTestAction } = await import("./launch-actions");

let projectId: string;
const pids: number[] = [];

/** A bare repository with `files` on main, as a project's local clone. */
function origin(files: Record<string, string>) {
  const work = mkdtempSync(join(tmpdir(), "handoff-launch-work-"));
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "ignore" });
  git(work, "init", "-q", "-b", "main");
  for (const [name, body] of Object.entries(files)) writeFileSync(join(work, name), body);
  git(work, "add", "-A");
  git(work, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "initial");
  const bare = mkdtempSync(join(tmpdir(), "handoff-launch-origin-"));
  git(bare, "clone", "-q", "--bare", work, ".");
  return bare;
}

beforeEach(async () => {
  await truncateAll(db);
  env.revalidated.length = 0;
  vi.stubEnv("HANDOFF_HOME", mkdtempSync(join(tmpdir(), "handoff-home-")));
  vi.stubEnv("HANDOFF_WORKSPACE", "worktree");
  projectId = (await createProject(db, { name: "shop", repo: "octo/shop", defaultBranch: "main" })).id;
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const pid of pids.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {}
  }
});
afterAll(() => db.$client.end());

const form = (overrides: Partial<LaunchForm> = {}): LaunchForm => ({ command: "node app.js", cwd: "", port: "3000", anyPort: true, url: "", env: [], ...overrides });
const saved = async () => (await db.select({ launch: projects.launch }).from(projects).where(eq(projects.id, projectId)))[0]!.launch;

test("Save stores the form as the project's App launch setting, and a form with mistakes says what to fix and stores nothing", async () => {
  expect(await saveAppLaunchAction({ projectId, form: form({ command: "pnpm dev", env: [{ name: "NODE_ENV", value: "development" }] }) })).toEqual({ ok: true });
  expect(await saved()).toEqual({ name: "app", runtimeExecutable: "pnpm", runtimeArgs: ["dev"], args: [], port: 3000, env: { NODE_ENV: "development" } });
  expect(env.revalidated).toContain(`/projects/${projectId}/settings`);

  expect(await saveAppLaunchAction({ projectId, form: form({ command: "", port: "0" }) })).toEqual({
    ok: false,
    errors: { command: expect.any(String), port: expect.any(String) },
  });
  expect(await saved()).toMatchObject({ runtimeExecutable: "pnpm" });
  expect(await saveAppLaunchAction({ projectId: "not-a-project", form: form() })).toMatchObject({ ok: false, error: expect.any(String) });
});

test("Test start starts the app from the form's values, unsaved, until Stop", async () => {
  const server = `require("node:http").createServer((_, res) => res.end("ok")).listen(Number(process.env.PORT));`;
  await db.update(projects).set({ localClonePath: origin({ "app.js": server }) }).where(eq(projects.id, projectId));

  const started = await startLaunchTestAction({ projectId, form: form() });
  expect(started).toMatchObject({ ok: true, test: { status: "starting", command: "node app.js" } });
  expect(await saved()).toBeNull();

  await expect.poll(async () => (await launchTestAction({ projectId }))?.status, { timeout: 20_000 }).toBe("ready");
  const ready = (await launchTestAction({ projectId }))!;
  expect(ready.steps.map((s) => s.name)).toEqual(["worktree", "services", "seed", "app"]);
  expect(await (await fetch(ready.url!.replace("localhost", "127.0.0.1"))).text()).toBe("ok");

  const stopped = await stopLaunchTestAction({ projectId, id: ready.id });
  expect(stopped).toMatchObject({ status: "stopped" });
});

test("Test start checks the form first", async () => {
  expect(await startLaunchTestAction({ projectId, form: form({ command: `sh -c "x` }) })).toEqual({ ok: false, errors: { command: expect.stringMatching(/quote/) } });
  expect(await launchTestAction({ projectId })).toBeNull();
});

test.skipIf(process.env.HANDOFF_TEST_DOCKER !== "1")("in Docker workspace mode Test start runs the app in a container until Stop", async () => {
  vi.stubEnv("HANDOFF_WORKSPACE", "docker");
  vi.stubEnv("HANDOFF_DOCKER_IMAGE", process.env.HANDOFF_TEST_DOCKER_IMAGE ?? "node:22-alpine");
  vi.stubEnv("HANDOFF_DOCKER_MOUNTS", "");
  vi.stubEnv("HANDOFF_DOCKER_NETWORK", "");
  const server = `require("node:http").createServer((_, res) => res.end("ok")).listen(Number(process.env.PORT), process.env.HOST);`;
  await db.update(projects).set({ localClonePath: origin({ "app.js": server }) }).where(eq(projects.id, projectId));
  const containersOf = (id: string) =>
    execFileSync("docker", ["ps", "-a", "--filter", `label=handoff.run=${id}`, "--format", "{{.Names}}"], { encoding: "utf8" }).split("\n").filter(Boolean);

  const started = await startLaunchTestAction({ projectId, form: form() });
  expect(started).toMatchObject({ ok: true, test: { status: "starting" } });
  const id = (started as { test: { id: string } }).test.id;
  try {
    await expect.poll(async () => (await launchTestAction({ projectId }))?.status, { timeout: 30_000 }).toBe("ready");
    const ready = (await launchTestAction({ projectId }))!;
    expect(ready.steps.at(-1)).toMatchObject({ name: "app", detail: `Listening on port ${ready.port} in container handoff-preview-${id.slice(0, 8)}` });
    expect(await (await fetch(ready.url!.replace("localhost", "127.0.0.1"))).text()).toBe("ok");

    expect(await stopLaunchTestAction({ projectId, id })).toMatchObject({ status: "stopped" });
    expect(containersOf(id)).toEqual([]);
  } finally {
    for (const name of containersOf(id)) execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
});

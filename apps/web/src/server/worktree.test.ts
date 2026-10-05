import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { workerHome, worktreeState, type WorktreeRun } from "./worktree";

const ID = "7f3a2c1e-4b0d-4c51-9a8e-2d6f1b3c9e07";
const OTHER = "0b9d4e2a-1c3f-4a5b-8d6e-7f8a9b0c1d2e";
let scratch: string;
let home: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "handoff-worktree-"));
  home = join(scratch, "home");
  mkdirSync(join(home, "worktrees"), { recursive: true });
});
afterEach(() => rmSync(scratch, { recursive: true, force: true }));

const run = (over: Partial<WorktreeRun>): WorktreeRun => ({ id: ID, status: "running", worktreePath: null, prNumber: null, ...over });
const made = (path: string) => (mkdirSync(path, { recursive: true }), path);

test("the dashboard finds the worker's HANDOFF_HOME: relative to apps/worker, or ./.handoff there without one", () => {
  expect(workerHome({ HANDOFF_HOME: "/srv/handoff" }, "/repo/apps/web")).toBe("/srv/handoff");
  expect(workerHome({ HANDOFF_HOME: "./.handoff" }, "/repo/apps/web")).toBe("/repo/apps/worker/.handoff");
  expect(workerHome({}, "/repo/apps/web")).toBe("/repo/apps/worker/.handoff");
});

test("a queued run has no worktree yet", () => {
  expect(worktreeState(run({ status: "queued" }), home)).toEqual({ state: "not-created" });
  expect(worktreeState(run({ status: "running" }), home)).toEqual({ state: "not-created" });
});

test("a run with its own worktree on disk gets the link, and says so while a step runs in it", () => {
  const path = made(join(home, "worktrees", ID));
  expect(worktreeState(run({ status: "running", worktreePath: path }), home)).toEqual({ state: "open", path, shown: path, running: true });
  expect(worktreeState(run({ status: "waiting", worktreePath: path }), home)).toMatchObject({ state: "open", path, running: false });
  expect(worktreeState(run({ status: "failed", worktreePath: path }), home)).toMatchObject({ state: "open", path, running: false });
});

test("the folder is shown with the home folder shortened to ~", () => {
  const under = join(homedir(), ".handoff");
  expect(worktreeState(run({ status: "succeeded" }), under)).toEqual({ state: "released", prNumber: null });
  const missing = join(under, "worktrees", ID);
  expect(worktreeState(run({ status: "waiting", worktreePath: missing }), under)).toEqual({ state: "missing", shown: `~/.handoff/worktrees/${ID}` });
});

test("a finished or cancelled run's worktree was removed, and a merged run points at its pull request", () => {
  expect(worktreeState(run({ status: "succeeded", prNumber: 88 }), home)).toEqual({ state: "released", prNumber: 88 });
  expect(worktreeState(run({ status: "cancelled" }), home)).toEqual({ state: "released", prNumber: null });
});

test("a failed run without its worktree had it removed by handoff gc", () => {
  expect(worktreeState(run({ status: "failed" }), home)).toEqual({ state: "removed-by-gc" });
});

test("a stored path whose folder is gone is missing on disk", () => {
  const path = join(home, "worktrees", ID);
  expect(worktreeState(run({ status: "running", worktreePath: path }), home)).toEqual({ state: "missing", shown: path });
  writeFileSync(path, "not a folder");
  expect(worktreeState(run({ status: "running", worktreePath: path }), home)).toEqual({ state: "missing", shown: path });
});

test.each([
  ["outside HANDOFF_HOME", () => made(join(scratch, "elsewhere", "worktrees", ID))],
  ["another run's worktree", () => made(join(home, "worktrees", OTHER))],
  ["a folder below the worktree", () => made(join(home, "worktrees", ID, "src"))],
  ["a path with ..", () => (made(join(home, "worktrees", ID)), `${home}/worktrees/${OTHER}/../${ID}`)],
  ["a path with .", () => (made(join(home, "worktrees", ID)), `${home}/worktrees/./${ID}`)],
  ["a relative path", () => (made(join(home, "worktrees", ID)), join("worktrees", ID))],
  ["a path with a trailing slash", () => (made(join(home, "worktrees", ID)), `${home}/worktrees/${ID}/`)],
  ["HANDOFF_HOME itself", () => home],
])("the link is refused for %s", (_, path) => {
  const stored = path();
  const state = worktreeState(run({ status: "running", worktreePath: stored }), home);
  expect(state).toEqual({ state: "missing", shown: stored });
});

test("a symbolic link in the worktree's place is refused, though it points at a folder", () => {
  const target = made(join(scratch, "elsewhere"));
  const path = join(home, "worktrees", ID);
  symlinkSync(target, path);
  expect(worktreeState(run({ status: "running", worktreePath: path }), home)).toEqual({ state: "missing", shown: path });
});

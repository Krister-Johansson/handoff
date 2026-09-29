import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { eq, graphVersions, nodeExecutions, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { runCli } from "./cli.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

function capture() {
  const lines: string[] = [];
  return { out: (line: string) => void lines.push(line), lines };
}

function graphFile(doc: unknown) {
  const path = join(mkdtempSync(join(tmpdir(), "graph-")), "g.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

test("project add stores the repository", async () => {
  const { out, lines } = capture();
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample", "--branch", "trunk"], { db, out });
  const [project] = await db.select().from(projects);
  expect(project).toMatchObject({ name: "scratch", repoOwner: "octo", repoName: "sample", defaultBranch: "trunk" });
  expect(lines.join("\n")).toContain("scratch");
});

test("graph import stores a new version each time", async () => {
  const { out } = capture();
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out });
  const file = graphFile(linear);
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", file], { db, out });
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", file], { db, out });
  expect((await db.select().from(graphVersions)).map((v) => v.version).sort()).toEqual([1, 2]);
});

test("graph import rejects a graph that does not compile and lists the errors", async () => {
  const { out } = capture();
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out });
  const broken = structuredClone(linear);
  broken.attributes.startNode = "ghost";
  await expect(runCli(["graph", "import", "--project", "scratch", "--name", "linear", graphFile(broken)], { db, out })).rejects.toThrow(
    /missing_start_node/,
  );
});

test("handoff run inserts a queued run and prints its id", async () => {
  const { out, lines } = capture();
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out });
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", graphFile(linear)], { db, out });
  await runCli(["run", "--project", "scratch", "--graph", "linear", "--task", "Add a CHANGELOG.md"], { db, out });
  const [run] = await db.select().from(runs);
  expect(run).toMatchObject({ status: "queued", task: "Add a CHANGELOG.md" });
  expect(lines.some((l) => l.includes(run!.id))).toBe(true);
  expect(await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, run!.id))).toHaveLength(1);
});

test("unknown commands print usage and fail", async () => {
  const { out } = capture();
  await expect(runCli(["frobnicate"], { db, out })).rejects.toThrow(/usage/i);
});

async function queuedRun(out: (l: string) => void) {
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out });
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", graphFile(linear)], { db, out });
  await runCli(["run", "--project", "scratch", "--graph", "linear", "--task", "t"], { db, out });
  const [run] = await db.select().from(runs);
  return run!;
}

test("handoff run cancel marks the run cancelled", async () => {
  const { out, lines } = capture();
  const run = await queuedRun(out);
  await runCli(["run", "cancel", run.id], { db, out });
  const [row] = await db.select().from(runs).where(eq(runs.id, run.id));
  expect(row?.status).toBe("cancelled");
  expect(lines.at(-1)).toContain("cancelled");
});

test("handoff run repair requires a failed node", async () => {
  const { out } = capture();
  const run = await queuedRun(out);
  await expect(runCli(["run", "repair", run.id, "--node", "planner"], { db, out })).rejects.toThrow(/no failed execution/);
});

test("handoff answer records the answer for an open question", async () => {
  const { out, lines } = capture();
  const run = await queuedRun(out);
  const [exec] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, run.id));
  const { questions } = await import("@handoff/db");
  const [q] = await db.insert(questions).values({ runId: run.id, nodeExecutionId: exec!.id, question: "ISO?", options: ["ISO", "US"] }).returning();
  await runCli(["answer", q!.id, "Use ISO", "--option", "ISO"], { db, out });
  const [after] = await db.select().from(questions).where(eq(questions.id, q!.id));
  expect(after).toMatchObject({ answer: "Use ISO", option: "ISO", answeredBy: "cli" });
  expect(lines.at(-1)).toContain("answered");
});

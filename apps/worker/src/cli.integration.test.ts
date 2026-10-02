import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { appendEvents, eq, graphVersions, nodeExecutions, projects, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
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
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample", "--branch", "trunk"], { db, out, github: null });
  const [project] = await db.select().from(projects);
  expect(project).toMatchObject({ name: "scratch", repoOwner: "octo", repoName: "sample", defaultBranch: "trunk" });
  expect(lines.join("\n")).toContain("scratch");
});

test("project add without --name names the project after the repository", async () => {
  const { out } = capture();
  await runCli(["project", "add", "--repo", "octo/gqlPrune"], { db, out, github: null });
  const [project] = await db.select().from(projects);
  expect(project).toMatchObject({ name: "gqlprune", repoName: "gqlPrune" });
});

test("library import-repo imports a repository's skills as a group", async () => {
  const { out, lines } = capture();
  const repo = mkdtempSync(join(tmpdir(), "skills-repo-"));
  mkdirSync(join(repo, "skills", "pdf"), { recursive: true });
  writeFileSync(join(repo, "skills", "pdf", "SKILL.md"), "---\nname: pdf\ndescription: PDFs.\n---\n\nBody\n");
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: repo });
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-qm", "x"], { cwd: repo });
  await runCli(["library", "import-repo", "anthropics/skills", "--group", "anthropic", "--url", repo], { db, out, github: null });
  expect(lines.join("\n")).toMatch(/imported\s+pdf/);
  expect(lines.at(-1)).toBe("group anthropic: 1 skills");
});

test("graph import stores a new version each time", async () => {
  const { out } = capture();
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out, github: null });
  const file = graphFile(linear);
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", file], { db, out, github: null });
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", file], { db, out, github: null });
  expect((await db.select().from(graphVersions)).map((v) => v.version).sort()).toEqual([1, 2]);
});

test("graph import rejects a graph that does not compile and lists the errors", async () => {
  const { out } = capture();
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out, github: null });
  const broken = structuredClone(linear);
  broken.attributes.startNode = "ghost";
  await expect(runCli(["graph", "import", "--project", "scratch", "--name", "linear", graphFile(broken)], { db, out, github: null })).rejects.toThrow(
    /missing_start_node/,
  );
});

test("handoff run --issue links issues, and without --task uses their titles", async () => {
  const { out } = capture();
  const github = new FakeGitHub();
  github.issues.set(12, { number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12", body: "2nd", state: "open" });
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out, github: null });
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", graphFile(linear)], { db, out, github: null });
  await runCli(["run", "--project", "scratch", "--graph", "linear", "--issue", "12"], { db, out, github });
  const [run] = await db.select().from(runs);
  expect(run).toMatchObject({ task: "#12 Slugify drops digits", issues: [{ number: 12, title: "Slugify drops digits", url: "https://github.com/octo/sample/issues/12" }] });
});

test("handoff run inserts a queued run and prints its id", async () => {
  const { out, lines } = capture();
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out, github: null });
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", graphFile(linear)], { db, out, github: null });
  await runCli(["run", "--project", "scratch", "--graph", "linear", "--task", "Add a CHANGELOG.md"], { db, out, github: null });
  const [run] = await db.select().from(runs);
  expect(run).toMatchObject({ status: "queued", task: "Add a CHANGELOG.md", startedBy: "cli" });
  expect(lines.some((l) => l.includes(run!.id))).toBe(true);
  expect(await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, run!.id))).toHaveLength(1);
});

test("unknown commands print usage and fail", async () => {
  const { out } = capture();
  await expect(runCli(["frobnicate"], { db, out, github: null })).rejects.toThrow(/usage/i);
});

async function queuedRun(out: (l: string) => void) {
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out, github: null });
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", graphFile(linear)], { db, out, github: null });
  await runCli(["run", "--project", "scratch", "--graph", "linear", "--task", "t"], { db, out, github: null });
  const [run] = await db.select().from(runs);
  return run!;
}

test("handoff run cancel marks the run cancelled", async () => {
  const { out, lines } = capture();
  const run = await queuedRun(out);
  await runCli(["run", "cancel", run.id], { db, out, github: null });
  const [row] = await db.select().from(runs).where(eq(runs.id, run.id));
  expect(row?.status).toBe("cancelled");
  expect(lines.at(-1)).toContain("cancelled");
});

test("handoff run cancel sets the run's task back to Ready on the plan", async () => {
  const { out } = capture();
  const repo = { owner: "octo", name: "sample" };
  const github = new FakeGitHub();
  const plan = new FakeProjects(github);
  const { number } = await plan.createProject("octo", repo, "scratch plan");
  const task = await plan.createIssue(repo, { project: number, title: "Add the migration", body: "Add the column.", labels: ["task"] });
  plan.itemsOf(repo).get(task.number)!.status = "Running";
  await runCli(["project", "add", "--name", "scratch", "--repo", "octo/sample"], { db, out, github: null });
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.name, "scratch"));
  await runCli(["graph", "import", "--project", "scratch", "--name", "linear", graphFile(linear)], { db, out, github: null });
  await runCli(["run", "--project", "scratch", "--graph", "linear", "--issue", String(task.number)], { db, out, github });
  const [run] = await db.select().from(runs);
  // The move to Running a run started on a Ready task records; cancel puts back the Status it came from.
  await db.transaction((tx) => appendEvents(tx, run!.id, [{ type: "plan.status", payload: { issue: task.number, status: "Running", from: "Ready" } }]));
  await runCli(["run", "cancel", run!.id], { db, out, github: null, projects: plan });
  expect(await plan.getStatus(repo, number, task.number)).toBe("Ready");
});

test("handoff run repair requires a failed node", async () => {
  const { out } = capture();
  const run = await queuedRun(out);
  await expect(runCli(["run", "repair", run.id, "--node", "planner"], { db, out, github: null })).rejects.toThrow(/no failed execution/);
});

test("handoff answer records the answer for an open question", async () => {
  const { out, lines } = capture();
  const run = await queuedRun(out);
  const [exec] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, run.id));
  const { questions } = await import("@handoff/db");
  const [q] = await db.insert(questions).values({ runId: run.id, nodeExecutionId: exec!.id, question: "ISO?", options: ["ISO", "US"] }).returning();
  await runCli(["answer", q!.id, "Use ISO", "--option", "ISO"], { db, out, github: null });
  const [after] = await db.select().from(questions).where(eq(questions.id, q!.id));
  expect(after).toMatchObject({ answer: "Use ISO", option: "ISO", answeredBy: "cli" });
  expect(lines.at(-1)).toContain("answered");
});

test("handoff library import-skill reads SKILL.md frontmatter and supporting files", async () => {
  const { out, lines } = capture();
  const dir = mkdtempSync(join(tmpdir(), "skill-"));
  const { mkdirSync } = await import("node:fs");
  writeFileSync(join(dir, "SKILL.md"), "---\nname: ci-triage\ndescription: Use when CI failed.\n---\n\n# CI triage\n\nStart from the failing test.\n");
  mkdirSync(join(dir, "refs"));
  writeFileSync(join(dir, "refs", "logs.md"), "How to read logs.");
  await runCli(["library", "import-skill", dir], { db, out, github: null });
  const { librarySkills } = await import("@handoff/db");
  const [skill] = await db.select().from(librarySkills);
  expect(skill).toMatchObject({ name: "ci-triage", description: "Use when CI failed.", files: [{ path: "refs/logs.md", content: "How to read logs." }] });
  expect(skill!.body).toBe("# CI triage\n\nStart from the failing test.");
  expect(lines.at(-1)).toContain("ci-triage");
});

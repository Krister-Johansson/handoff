import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { and, appendEvents, createNotification, eq, events, nodeExecutions, permissionRequests, projects, projectSchedulers, questions, registerWorker, runs, schedulerEvents, sql, workers } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { checkProject } from "@handoff/engine/backlog-scheduler";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { CATALOG, toolSpec } from "../lib/assistant/catalog";
import { runPath } from "../lib/paths";
import { addDays } from "../lib/plan/timeline-scale";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHandoffMcpServer, registerDataTools } from "./agent-mcp";
import { createProject, saveGraphVersion } from "./graphs";

const db = createTestDb();
const BASE = "http://localhost:3000";
let client: Client;
let github: FakeGitHub;
let plan: FakeProjects;
let projectId: string;

beforeEach(async () => {
  await truncateAll(db);
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  projectId = project.id;
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  github = new FakeGitHub();
  for (const number of [11, 12]) {
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: `Body ${number}`, state: "open", updatedAt: `2026-09-30T0${number - 10}:00:00Z` });
  }
  plan = new FakeProjects(github);
  const server = createHandoffMcpServer({ db, github, projects: plan, baseUrl: BASE });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});
afterEach(() => client.close());
afterAll(() => db.$client.end());

/** Calls a tool and parses its JSON text; tool errors come back as { error }. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
  const text = result.content[0]?.text ?? "";
  return result.isError ? { error: text } : JSON.parse(text);
}

test("the agent MCP server lists exactly the catalog's data tools with their descriptions and annotations", async () => {
  const { tools } = await client.listTools();
  const data = CATALOG.filter((t) => t.kind === "data");
  expect(tools.map((t) => t.name).sort()).toEqual(data.map((t) => t.name).sort());
  for (const spec of data) {
    const listed = tools.find((t) => t.name === spec.name)!;
    expect(listed.description).toBe(spec.description);
    expect(listed.annotations).toMatchObject({ readOnlyHint: spec.readOnly, title: spec.title });
  }
  expect(tools.find((t) => t.name === "cancel_run")?.annotations?.destructiveHint).toBe(true);
});

test("setup_project says what the project still needs to work well with handoff, and how to fix it", async () => {
  github.files.set("CLAUDE.md", "# sample");
  const result = await call("setup_project", { project: "sandbox" });
  expect(result).toMatchObject({ project: { name: "sandbox", repo: "octo/sample" }, ready: false });
  const byId = Object.fromEntries((result.checks as { id: string; status: string; fix?: string }[]).map((c) => [c.id, c]));
  expect(byId.graph).toMatchObject({ status: "ok" });
  expect(byId.claude_md).toMatchObject({ status: "ok" });
  expect(byId.worker).toMatchObject({ status: "todo", fix: expect.stringContaining("pnpm dev:worker") });
  expect(byId.launch).toMatchObject({ status: "todo", fix: expect.stringContaining("PORT") });
  expect(result.guide).toContain("handoff-setup");
});

test("projects and the backlog are listed, and an issue leaves the backlog once a run works on it", async () => {
  expect(await call("list_projects")).toEqual([expect.objectContaining({ name: "sandbox", repo: "octo/sample", default_branch: "main" })]);
  expect((await call("list_backlog", { project: "sandbox" })).map((i: { number: number }) => i.number)).toEqual([12, 11]);
  await call("start_run", { project: "sandbox", issues: [11] });
  expect((await call("list_backlog", { project: "sandbox" })).map((i: { number: number }) => i.number)).toEqual([12]);
  expect(await call("list_backlog", { project: "nope" })).toEqual({ error: expect.stringMatching(/no project/i) });
});

test("start_run starts a run on the default graph linked to the issues, and get_run follows it", async () => {
  const started = await call("start_run", { project: "sandbox", issues: [11] });
  expect(started).toMatchObject({ run_id: expect.any(String), status: "queued", url: expect.stringMatching(new RegExp(`^${BASE}/projects/[0-9a-f-]+/runs/`)) });
  const [run] = await db.select().from(runs).where(eq(runs.id, started.run_id));
  expect(run?.issues.map((i) => i.number)).toEqual([11]);
  const detail = await call("get_run", { run_id: started.run_id });
  expect(detail).toMatchObject({ status: "queued", project: "sandbox", graph: "linear", issues: [{ number: 11 }], steps: [{ node: "planner", attempt: 1, status: "pending" }], pr: null, questions: [] });
});

test("start_run records claude-code as the starter", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", issues: [11] });
  const [run] = await db.select().from(runs).where(eq(runs.id, run_id));
  expect(run?.startedBy).toBe("claude-code");
  expect(await call("get_run", { run_id })).toMatchObject({ started_by: "claude-code" });
  expect(await call("list_runs", { project: "sandbox" })).toEqual([expect.objectContaining({ id: run_id, started_by: "claude-code" })]);
  // A second start on the same issue is refused and names the run that has it.
  expect(await call("start_run", { project: "sandbox", issues: [11] })).toEqual({ error: expect.stringContaining(`#11 is taken by run ${run_id}`) });
});

test("a question is answered once for the person, and a second answer is refused", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Pick a license for the repository" });
  const gate = await seedExecution(db, run_id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db.insert(questions).values({ runId: run_id, nodeExecutionId: gate.id, question: "Which license?" }).returning();
  expect((await call("get_run", { run_id })).questions).toEqual([{ id: question!.id, node: "gate", question: "Which license?", options: [] }]);
  expect(await call("answer_question", { question_id: question!.id, answer: "MIT" })).toMatchObject({ answered: true, run_id });
  const [answered] = await db.select().from(questions).where(eq(questions.id, question!.id));
  expect(answered).toMatchObject({ answer: "MIT", answeredBy: "claude-code" });
  expect(await call("answer_question", { question_id: question!.id, answer: "Apache-2.0" })).toEqual({ error: expect.stringMatching(/already answered/) });
});

test("a review can be answered with comments on lines of a file", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  const gate = await seedExecution(db, run_id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db.insert(questions).values({ runId: run_id, nodeExecutionId: gate.id, question: "Review the code from coder", options: ["approve", "changes"] }).returning();
  const comment = { path: "src/a.ts", line: 3, endLine: 4, quote: "const a = 1;", body: "Rename this." };
  expect(await call("answer_question", { question_id: question!.id, answer: "One change.", option: "changes", comments: [comment] })).toMatchObject({ answered: true });
  const [answered] = await db.select().from(questions).where(eq(questions.id, question!.id));
  expect(answered?.comments).toEqual([comment]);
});

test("a failed run is repaired at its failed step, and a run can be cancelled", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.update(nodeExecutions).set({ status: "failed", error: { code: "x", message: "boom" } }).where(eq(nodeExecutions.runId, run_id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run_id));
  expect((await call("get_run", { run_id })).failed).toMatchObject({ node: "planner", attempt: 1, error: "boom" });
  expect(await call("repair_run", { run_id, note: "Try again" })).toMatchObject({ node: "planner", attempt: 2 });
  const retry = await db.select().from(nodeExecutions).where(and(eq(nodeExecutions.runId, run_id), eq(nodeExecutions.attempt, 2)));
  expect(retry[0]).toMatchObject({ status: "pending", repairNote: "Try again" });
  expect(await call("cancel_run", { run_id })).toMatchObject({ cancelled: true });
  expect((await call("get_run", { run_id })).status).toBe("cancelled");
});

test("repair_run allows the files it is given outside the plan for the repaired step", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.update(nodeExecutions).set({ status: "failed", error: { code: "paths_outside_plan", message: "files outside the plan: pnpm-lock.yaml" } }).where(eq(nodeExecutions.runId, run_id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run_id));
  expect(await call("repair_run", { run_id, allow_paths: ["pnpm-lock.yaml"] })).toMatchObject({ node: "planner", attempt: 2 });
  const [row] = await db.select().from(runs).where(eq(runs.id, run_id));
  expect(row!.state).toMatchObject({ memory: { planner: { extraPaths: [expect.objectContaining({ path: "pnpm-lock.yaml", by: "person" })] } } });
});

test("what needs attention comes with links to the dashboard", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.update(nodeExecutions).set({ status: "failed" }).where(eq(nodeExecutions.runId, run_id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run_id));
  expect(await call("list_attention")).toEqual([expect.objectContaining({ kind: "failed", title: "sandbox: run failed at planner", url: expect.stringMatching(new RegExp(`^${BASE}/projects/[0-9a-f-]+/runs/${run_id}$`)) })]);
});

test("list_notifications gives the feed as its senders wrote it, with each item's tone and a link to the dashboard", async () => {
  await createNotification(db, { tone: "neutral", title: "The worker restarted", body: "" });
  await db.execute(sql`update notifications set created_at = now() - interval '5 minutes'`);
  await createNotification(db, { tone: "attention", title: "sandbox: gate asks a question", body: "Which license?", href: "/projects/p1/runs/r1" });
  expect(await call("list_notifications")).toEqual({
    unread: 2,
    items: [
      { tone: "attention", title: "sandbox: gate asks a question", body: "Which license?", at: expect.any(String), unread: true, url: `${BASE}/projects/p1/runs/r1` },
      { tone: "neutral", title: "The worker restarted", body: "", at: expect.any(String), unread: true, url: null },
    ],
  });
  expect((await call("list_notifications", { filter: "attention" })).items.map((n: { title: string }) => n.title)).toEqual(["sandbox: gate asks a question"]);
});

test("add_project adds a repository the credential can reach, on its default branch, and refuses one twice", async () => {
  github.repos = [{ id: 7, owner: "octo", name: "widgets", fullName: "octo/widgets", defaultBranch: "trunk", private: false, description: null, pushedAt: null, archived: false }];
  expect(await call("add_project", { repo: "octo/widgets" })).toMatchObject({ name: "widgets", repo: "octo/widgets", default_branch: "trunk", url: expect.stringMatching(new RegExp(`^${BASE}/projects/`)) });
  expect((await call("list_projects")).map((p: { name: string }) => p.name)).toEqual(["sandbox", "widgets"]);
  expect(await call("add_project", { repo: "octo/widgets" })).toEqual({ error: expect.stringMatching(/already a project/) });
});

test("list_runs says which step each active run is on, and for how long", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  const started = new Date(Date.now() - 40 * 60_000);
  await db.update(nodeExecutions).set({ status: "running", startedAt: started }).where(eq(nodeExecutions.runId, run_id));
  const [listed] = await call("list_runs", { status: "active" });
  expect(listed.current_step).toMatchObject({ node: "planner", attempt: 1, status: "running", since: started.toISOString() });
  expect(listed.current_step.for_seconds).toBeGreaterThanOrEqual(40 * 60);
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, run_id));
  await db.update(nodeExecutions).set({ status: "passed", finishedAt: new Date() }).where(eq(nodeExecutions.runId, run_id));
  expect((await call("list_runs"))[0].current_step).toBeNull();
});

test("get_run gives each step its start, end and duration, counting a running step up to now", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.update(nodeExecutions).set({ status: "passed", startedAt: new Date("2026-10-01T10:00:00Z"), finishedAt: new Date("2026-10-01T10:04:00Z") }).where(eq(nodeExecutions.runId, run_id));
  await seedExecution(db, run_id, { nodeKey: "coder", status: "running", startedAt: new Date(Date.now() - 90_000) });
  const { steps } = await call("get_run", { run_id });
  expect(steps[0]).toMatchObject({ node: "planner", started_at: "2026-10-01T10:00:00.000Z", finished_at: "2026-10-01T10:04:00.000Z", duration_seconds: 240 });
  expect(steps[1]).toMatchObject({ node: "coder", status: "running", finished_at: null });
  expect(steps[1].duration_seconds).toBeGreaterThanOrEqual(90);
});

test("a finished run can be dismissed from what needs attention; questions cannot", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.transaction((tx) => appendEvents(tx, run_id, [{ type: "run.finish", payload: { notify: true } }]));
  expect((await call("list_attention")).map((i: { id: string }) => i.id)).toEqual([`finished:${run_id}`]);
  expect(await call("dismiss_attention", { item_id: `finished:${run_id}` })).toEqual({ dismissed: true });
  expect(await call("list_attention")).toEqual([]);
  expect(await call("dismiss_attention", { item_id: "question:abc" })).toEqual({ error: expect.stringMatching(/only finished and failed runs/i) });
});

test("a run stopped by a loop that ran out says so, asks for a decision, and goes on when given one", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  const [planner] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, run_id));
  const review = { verdict: "request_changes", comments: [{ path: "src/a.ts", line: 4, body: "The empty list still crashes.", severity: "blocking" }] };
  await db.update(nodeExecutions).set({ status: "passed", output: review }).where(eq(nodeExecutions.id, planner!.id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run_id));
  await db.transaction((tx) =>
    appendEvents(tx, run_id, [
      { type: "edge.exhausted", payload: { edgeKey: "planner->planner", attempts: 3 }, nodeExecutionId: planner!.id },
      { type: "run.failed", payload: { reason: "loop_exhausted", nodeKey: "planner", awaiting: "repair" } },
    ]),
  );
  expect(await call("list_attention")).toEqual([
    expect.objectContaining({ id: `stuck:${run_id}`, kind: "failed", title: "sandbox: planner ran out of rounds", url: expect.stringMatching(new RegExp(`^${BASE}/projects/[0-9a-f-]+/runs/${run_id}$`)) }),
  ]);
  // The last review that wanted another round says why.
  expect((await call("get_run", { run_id })).stuck).toEqual({ node: "planner", loop: "planner->planner", attempts: 3, last_review: review });
  expect(await call("resolve_loop", { run_id, action: "continue" })).toMatchObject({ resolved: "continue" });
  const steps = (await call("get_run", { run_id })).steps.map((s: { node: string }) => s.node);
  expect(steps).toEqual(["planner", "coder"]);
  expect((await call("get_run", { run_id })).stuck).toBeNull();
});

test("the merge queue lists ready pull requests in order, and a merge can be asked for one or all", async () => {
  const first = (await call("start_run", { project: "sandbox", task: "First" })).run_id;
  const second = (await call("start_run", { project: "sandbox", task: "Second" })).run_id;
  await db.update(runs).set({ mergeQueuedAt: new Date("2026-10-01T10:00:00Z"), prNumber: 7 }).where(eq(runs.id, first));
  await db.update(runs).set({ mergeQueuedAt: new Date("2026-10-01T10:05:00Z"), prNumber: 8 }).where(eq(runs.id, second));
  expect(await call("list_merge_queue", { project: "sandbox" })).toMatchObject([
    { position: 1, run_id: first, pr: 7, requested: false, mode: "manual" },
    { position: 2, run_id: second, pr: 8, requested: false, mode: "manual" },
  ]);
  expect(await call("request_merge", { run_id: second })).toMatchObject({ requested: [second] });
  expect(await call("request_merge", { project: "sandbox", all: true })).toMatchObject({ requested: [first, second] });
  expect((await call("list_merge_queue", { project: "sandbox" })).map((e: { requested: boolean }) => e.requested)).toEqual([true, true]);
  expect(await call("request_merge", {})).toMatchObject({ error: expect.stringContaining("run_id") });
});

async function startedRun() {
  const started = await call("start_run", { project: "sandbox", issues: [11] });
  return started.run_id as string;
}

test("list_inbox groups permission requests, reviews, questions, ready to merge, failed, stuck and pull requests for one project", async () => {
  const runId = await startedRun();
  const coder = await seedExecution(db, runId, { nodeKey: "coder", status: "running" });
  await db.insert(permissionRequests).values({ id: "3f6b2a10-0000-4000-8000-000000000001", runId, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "git -C /w log" } });
  const gate = await seedExecution(db, runId, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId, nodeExecutionId: gate.id, question: "Which license?" });
  const inbox = await call("list_inbox", { project: "sandbox" });
  expect(Object.keys(inbox).sort()).toEqual(["failed_runs", "permissions", "pull_requests", "questions", "ready_to_merge", "reviews", "stuck_runs"]);
  expect(inbox.permissions).toEqual([
    expect.objectContaining({ id: "3f6b2a10-0000-4000-8000-000000000001", node: "coder", tool: "Bash", asks: "asks to run a command", detail: "git -C /w log", url: expect.stringContaining(`/runs/${runId}`) }),
  ]);
  expect(inbox.questions).toEqual([expect.objectContaining({ question: "Which license?", url: expect.stringContaining(`/runs/${runId}`) })]);
  expect((await call("list_inbox", { project: "nowhere" })).error).toMatch(/no project nowhere/);
});

test("get_run_events returns the latest lines of a run with secrets redacted and a cap", async () => {
  const runId = await startedRun();
  const many = Array.from({ length: 60 }, (_, i) => ({ type: "node.claimed", payload: { nodeKey: `step${i}`, attempt: 1 } }));
  await db.transaction((tx) => appendEvents(tx, runId, [...many, { type: "node.failed", payload: { nodeKey: "coder", attempt: 1, error: { message: "push failed with ghp_abcdefghijklmnopqrstuvwxyz0123456789" } } }]));
  const result = await call("get_run_events", { run_id: runId, limit: 5 });
  expect(result.events).toHaveLength(5);
  expect(result.events.at(-1)).toMatch(/node\.failed coder, attempt 1: push failed with /);
  expect(JSON.stringify(result)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  expect((await call("get_run_events", { run_id: runId })).events).toHaveLength(50);
});

test("answer_permission allows a pending request once and records who decided", async () => {
  const runId = await startedRun();
  const coder = await seedExecution(db, runId, { nodeKey: "coder", status: "running" });
  await db.insert(permissionRequests).values({ id: "3f6b2a10-0000-4000-8000-000000000002", runId, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "ls" } });
  expect(await call("answer_permission", { request_id: "3f6b2a10-0000-4000-8000-000000000002", decision: "allow" })).toMatchObject({ decision: "allowed" });
  const [row] = await db.select().from(permissionRequests).where(eq(permissionRequests.id, "3f6b2a10-0000-4000-8000-000000000002"));
  expect(row).toMatchObject({ status: "allowed", decidedBy: "claude-code" });
  expect((await call("answer_permission", { request_id: "3f6b2a10-0000-4000-8000-000000000002", decision: "deny" })).error).toMatch(/already answered/);
});

test("get_run lists a pending permission prompt with the full command", async () => {
  const runId = await startedRun();
  const coder = await seedExecution(db, runId, { nodeKey: "coder", status: "running", waitingOn: "permission" });
  const command = `pnpm --filter @todo/web exec vitest run ${"src/components/very/long/path/to/a/test-file.test.tsx ".repeat(6)}--reporter verbose`;
  const id = "3f6b2a10-0000-4000-8000-000000000003";
  await db.insert(permissionRequests).values({ id, runId, nodeExecutionId: coder.id, toolName: "Bash", input: { command } });
  await db.insert(permissionRequests).values({ id: "3f6b2a10-0000-4000-8000-000000000004", runId, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "ls" }, status: "allowed" });
  const { permissions } = await call("get_run", { run_id: runId });
  expect(command.length).toBeGreaterThan(300);
  expect(permissions).toEqual([{ id, node: "coder", attempt: 1, tool: "Bash", asks: "asks to run a command", detail: command, input: { command }, asked_at: expect.any(String) }]);
});

test("get_run on a Try it gate has the app URL, the criteria and the demo's notes", async () => {
  const runId = await startedRun();
  await seedExecution(db, runId, { nodeKey: "demo", nodeType: "demo", status: "passed", output: { summary: "Created a task and reloaded the page.", shots: [] } });
  const gate = await seedExecution(db, runId, { nodeKey: "try", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const context = {
    reason: "try",
    acceptance: ["A user can create a task", "A task survives a reload"],
    preview: { id: "p1", url: "http://localhost:4123", status: "running" },
    shots: [
      { id: "s1", caption: "The new task in the list", works: true, criterion: "A user can create a task" },
      { id: "s2", caption: "The list is empty after a reload", works: false, criterion: "A task survives a reload" },
    ],
  };
  const [question] = await db.insert(questions).values({ runId, nodeExecutionId: gate.id, question: "Try the app and check each acceptance criterion.", options: ["approve", "changes"], context }).returning();
  const [asked] = (await call("get_run", { run_id: runId })).questions;
  expect(asked).toMatchObject({ id: question!.id, node: "try", options: ["approve", "changes"] });
  expect(asked.try).toEqual({
    app_url: "http://localhost:4123",
    app: "running",
    demo_summary: "Created a task and reloaded the page.",
    criteria: [
      { criterion: "A user can create a task", demo: [{ note: "The new task in the list", works: true, screenshot_url: `${BASE}/api/screenshots/s1` }] },
      { criterion: "A task survives a reload", demo: [{ note: "The list is empty after a reload", works: false, screenshot_url: `${BASE}/api/screenshots/s2` }] },
    ],
    url: `${BASE}${runPath(projectId, runId)}/try/${question!.id}`,
  });
});

test("get_run has the cost, the failure code and the answered gates", async () => {
  const runId = await startedRun();
  await db.update(nodeExecutions).set({ status: "passed", costUsd: "0.250000" }).where(eq(nodeExecutions.runId, runId));
  const gate = await seedExecution(db, runId, { nodeKey: "plan_gate", nodeType: "human_gate", executorKind: "human", status: "passed" });
  const [answered] = await db
    .insert(questions)
    .values({ runId, nodeExecutionId: gate.id, question: "Review the plan from planner", options: ["approve", "changes", "fix"], answer: "Keep the API as it is.", option: "approve", answeredBy: "krister", answeredAt: new Date("2026-10-02T09:00:00Z") })
    .returning();
  await seedExecution(db, runId, {
    nodeKey: "coder",
    status: "failed",
    costUsd: "1.500000",
    finishedAt: new Date(),
    error: { code: "cli_error_max_turns", message: "claude ended with error_max_turns", detail: { subtype: "error_max_turns", turns: 61, costUsd: 1.5, lastMessage: "Still wiring the form." } },
  });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, runId));
  const detail = await call("get_run", { run_id: runId });
  expect(detail.cost_usd).toBe(1.75);
  expect(detail.steps.map((s: { node: string; cost_usd: number | null }) => [s.node, s.cost_usd])).toEqual([["planner", 0.25], ["plan_gate", null], ["coder", 1.5]]);
  expect(detail.failed).toEqual({ node: "coder", attempt: 1, code: "cli_error_max_turns", error: "claude ended with error_max_turns", subtype: "error_max_turns", turns: 61, cost_usd: 1.5, last_message: "Still wiring the form." });
  expect(detail.answered).toEqual([
    { id: answered!.id, node: "plan_gate", question: "Review the plan from planner", option: "approve", answer: "Keep the API as it is.", comments: [], answered_by: "krister", answered_at: "2026-10-02T09:00:00.000Z" },
  ]);
});

test("a review gate lists approve, changes and fix, and answer_question refuses an option it does not list", async () => {
  const runId = await startedRun();
  const gate = await seedExecution(db, runId, { nodeKey: "code_gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const review = { from: "coder", kind: "code", markdown: "Adds the form." };
  const [question] = await db.insert(questions).values({ runId, nodeExecutionId: gate.id, question: "Review the code from coder", options: ["approve", "changes", "fix"], context: { reason: "approval", review } }).returning();
  expect((await call("get_run", { run_id: runId })).questions[0].options).toEqual(["approve", "changes", "fix"]);
  expect(await call("answer_question", { question_id: question!.id, answer: "Ship it.", option: "merge" })).toEqual({ error: 'The question takes one of approve, changes, fix; "merge" is not one of them.' });
  const [still] = await db.select().from(questions).where(eq(questions.id, question!.id));
  expect(still?.answer).toBeNull();
  expect(await call("answer_question", { question_id: question!.id, answer: "Rename the field, then it can go.", option: "fix" })).toMatchObject({ answered: true });
  expect((await db.select().from(questions).where(eq(questions.id, question!.id)))[0]).toMatchObject({ option: "fix", answeredBy: "claude-code" });
});

test("answer_question takes a verdict per criterion at a Try it gate", async () => {
  const runId = await startedRun();
  const context = { reason: "try", acceptance: ["A user can create a task", "A task survives a reload"] };
  let attempt = 0;
  const ask = async () => {
    const gate = await seedExecution(db, runId, { nodeKey: "try", nodeType: "human_gate", executorKind: "human", status: "waiting", attempt: ++attempt });
    return (await db.insert(questions).values({ runId, nodeExecutionId: gate.id, question: "Try the app.", options: ["approve", "changes"], context }).returning())[0]!;
  };
  const first = await ask();
  const broken = [
    { criterion: "A user can create a task", works: true },
    { criterion: "A task survives a reload", works: false, note: "The list is empty after a reload." },
  ];
  expect(await call("answer_question", { question_id: first.id, criteria: broken })).toMatchObject({ answered: true });
  expect((await db.select().from(questions).where(eq(questions.id, first.id)))[0]).toMatchObject({
    option: "changes",
    answer: "1 of 2 criteria does not work.",
    comments: [{ quote: "A task survives a reload", body: "The list is empty after a reload." }],
  });
  const second = await ask();
  expect(await call("answer_question", { question_id: second.id, criteria: broken.map((c) => ({ criterion: c.criterion, works: true })) })).toMatchObject({ answered: true });
  expect((await db.select().from(questions).where(eq(questions.id, second.id)))[0]).toMatchObject({ option: "approve", answer: "Every criterion works.", comments: [] });
  // Every criterion needs a verdict, and only the gate's criteria have one.
  const third = await ask();
  expect((await call("answer_question", { question_id: third.id, criteria: [{ criterion: "A user can create a task", works: true }] })).error).toMatch(/A task survives a reload/);
  expect((await call("answer_question", { question_id: third.id, criteria: [...broken, { criterion: "It is fast", works: true }] })).error).toMatch(/It is fast/);
});

test("list_attention has permission prompts and a failed item can be dismissed", async () => {
  const runId = await startedRun();
  const coder = await seedExecution(db, runId, { nodeKey: "coder", status: "running", waitingOn: "permission" });
  const id = "3f6b2a10-0000-4000-8000-000000000005";
  await db.insert(permissionRequests).values({ id, runId, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "pnpm list react" } });
  expect(await call("list_attention")).toEqual([
    { id: `permission:${id}`, kind: "permission", title: "sandbox: coder asks to run a command", body: "pnpm list react", projectId, url: `${BASE}${runPath(projectId, runId)}` },
  ]);

  await call("answer_permission", { request_id: id, decision: "deny" });
  await db.update(nodeExecutions).set({ status: "failed", error: { code: "x", message: "boom" } }).where(eq(nodeExecutions.id, coder.id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, runId));
  const [failed] = await call("list_attention");
  expect(failed).toMatchObject({ id: `failed:${coder.id}`, kind: "failed" });
  expect(await call("dismiss_attention", { item_id: failed.id })).toEqual({ dismissed: true });
  expect(await call("list_attention")).toEqual([]);
  // The run still waits for a repair in the inbox; only the notice is gone.
  expect((await call("list_inbox", { project: "sandbox" })).failed_runs).toHaveLength(1);
});

test("get_project returns each graph's latest version", async () => {
  await saveGraphVersion(db, { projectId, name: "linear", document: linear });
  await saveGraphVersion(db, { projectId, name: "alt", document: linear });
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md", graph: "linear" });
  const detail = await call("get_project", { project: "sandbox" });
  expect(detail.graphs).toEqual([
    { name: "alt", latest_version: 1 },
    { name: "linear", latest_version: 2 },
  ]);
  // A run keeps the version it started on.
  expect(detail.recent_runs).toEqual([expect.objectContaining({ id: run_id, graph: "linear", graph_version: 2 })]);
});

test("a pending step reports queued with its place", async () => {
  await registerWorker(db, { id: "worker-1", hostname: "box", caps: { cli: 1 } });
  const start = async (task: string) => (await call("start_run", { project: "sandbox", task })).run_id as string;
  const busy = await start("Running now");
  const asking = await start("Asks a person");
  const first = await start("Next in line");
  const second = await start("After that");
  const at = (s: number) => new Date(Date.now() - s * 1000);
  await db.update(nodeExecutions).set({ status: "running", startedAt: at(60) }).where(eq(nodeExecutions.runId, busy));
  await db.update(nodeExecutions).set({ status: "running", waitingOn: "permission", startedAt: at(50) }).where(eq(nodeExecutions.runId, asking));
  await db.update(nodeExecutions).set({ runnableAt: at(30) }).where(eq(nodeExecutions.runId, first));
  await db.update(nodeExecutions).set({ runnableAt: at(20) }).where(eq(nodeExecutions.runId, second));
  await seedExecution(db, busy, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting", waitKind: "human" });

  const byTask = Object.fromEntries((await call("list_runs", { project: "sandbox" })).map((r: { task: string; current_step: unknown }) => [r.task, r.current_step]));
  expect(byTask["Next in line"]).toMatchObject({ node: "planner", status: "pending", state: "queued", place: 1 });
  expect(byTask["After that"]).toMatchObject({ state: "queued", place: 2 });
  expect(byTask["Asks a person"]).toMatchObject({ status: "running", state: "waiting", waiting_on: "permission" });
  expect((await call("get_run", { run_id: second })).steps).toEqual([expect.objectContaining({ node: "planner", state: "queued", place: 2 })]);
  const steps = (await call("get_run", { run_id: busy })).steps;
  expect(steps).toEqual([expect.objectContaining({ node: "planner", state: "running" }), expect.objectContaining({ node: "gate", state: "waiting", waiting_on: "question" })]);
  expect(steps[0]).not.toHaveProperty("place");

  // With no worker running, a pending step waits on the worker.
  await db.update(workers).set({ stoppedAt: new Date() });
  expect((await call("get_run", { run_id: first })).steps[0]).toMatchObject({ state: "waiting", waiting_on: "worker", place: 1 });
});

test("answer_permission cannot always allow", async () => {
  expect((await call("answer_permission", { request_id: "x", decision: "always" })).error).toBeDefined();
});

test("start_run reports that it assigned the token's user to an issue nobody had, and why it assigned nobody", async () => {
  github.issues.get(12)!.assignees = ["ann"];
  expect(await call("start_run", { project: "sandbox", issues: [11, 12] })).toMatchObject({ assigned: [{ issue: 11, login: "octocat" }], not_assigned: [] });
  expect(github.issues.get(12)!.assignees).toEqual(["ann"]);

  github.login = undefined;
  github.issues.set(13, { number: 13, title: "Issue 13", url: "https://github.com/octo/sample/issues/13", body: "", state: "open" });
  expect(await call("start_run", { project: "sandbox", issues: [13] })).toMatchObject({
    assigned: [],
    not_assigned: [{ issue: 13, reason: "a GitHub App has no user to assign" }],
  });
});

test("assign sets an issue's assignees, adds the token's user for me, clears them with none, and leaves the plan's Status alone", async () => {
  const { task, statusOf } = await withPlan();
  const ready = await task("Add the migration", "Ready");
  github.assignable = [
    { login: "octocat", avatarUrl: "a1" },
    { login: "ann", avatarUrl: "a2" },
  ];
  expect(await call("assign", { project: "sandbox", issue: ready, logins: ["ann"] })).toMatchObject({ issue: ready, assignees: ["ann"] });
  expect(await call("assign", { project: "sandbox", issue: ready, logins: ["ann"], me: true })).toMatchObject({ assignees: ["ann", "octocat"] });
  expect(await call("assign", { project: "sandbox", issue: ready, logins: [] })).toMatchObject({ assignees: [] });
  expect(await statusOf(ready)).toBe("Ready");
  expect(await call("assign", { project: "sandbox", issue: ready, logins: ["stranger"] })).toEqual({ error: expect.stringContaining("stranger cannot be assigned") });

  github.login = undefined;
  expect(await call("assign", { project: "sandbox", issue: ready, logins: [], me: true })).toEqual({ error: expect.stringContaining("GitHub App") });
});

const repo = { owner: "octo", name: "sample" };

/** Gives the sandbox project a plan on its repository's GitHub Project, with `task` to add a task in a status. */
async function withPlan() {
  const { number } = await plan.createProject("octo", repo, "sandbox plan");
  await db.update(projects).set({ planProjectNumber: number }).where(eq(projects.id, projectId));
  const task = async (title: string, status: string) => {
    const created = await plan.createIssue(repo, { project: number, title, body: `${title} body`, labels: ["task"] });
    plan.itemsOf(repo).get(created.number)!.status = status;
    return created.number;
  };
  const statusOf = (issue: number) => plan.getStatus(repo, number, issue);
  return { number, task, statusOf };
}

const planEvents = async (runId: string) =>
  (await db.select({ type: events.type, payload: events.payload }).from(events).where(eq(events.runId, runId))).filter((e) => e.type.startsWith("plan."));

test("start_run over MCP sets the task to Running on the plan", async () => {
  const { task, statusOf } = await withPlan();
  const ready = await task("Add the migration", "Ready");
  const { run_id } = await call("start_run", { project: "sandbox", issues: [ready] });
  expect(await statusOf(ready)).toBe("Running");
  expect(await planEvents(run_id)).toEqual([{ type: "plan.status", payload: { issue: ready, status: "Running", from: "Ready" } }]);
});

test("list_backlog over MCP lists the plan's Ready tasks and the unplanned issues", async () => {
  const { task } = await withPlan();
  const ready = await task("Add the migration", "Ready");
  await task("Shape the gate", "Shaping");
  expect((await call("list_backlog", { project: "sandbox" })).map((i: { number: number }) => i.number).sort()).toEqual([11, 12, ready]);
});

test("cancel_run over MCP sets the task back to Ready", async () => {
  const { task, statusOf } = await withPlan();
  const ready = await task("Add the migration", "Ready");
  const { run_id } = await call("start_run", { project: "sandbox", issues: [ready] });
  await call("cancel_run", { run_id });
  expect(await statusOf(ready)).toBe("Ready");
});

test("resolve_loop with stop over MCP sets the task back to Ready", async () => {
  const { task, statusOf } = await withPlan();
  const ready = await task("Add the migration", "Ready");
  const { run_id } = await call("start_run", { project: "sandbox", issues: [ready] });
  const [planner] = await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, run_id)).returning();
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run_id));
  await db.transaction((tx) =>
    appendEvents(tx, run_id, [
      { type: "edge.exhausted", payload: { edgeKey: "planner->planner", attempts: 3 }, nodeExecutionId: planner!.id },
      { type: "run.failed", payload: { reason: "loop_exhausted", nodeKey: "planner", awaiting: "repair" } },
    ]),
  );
  expect(await call("resolve_loop", { run_id, action: "stop" })).toMatchObject({ resolved: "stop" });
  expect(await statusOf(ready)).toBe("Ready");
});

test("run_again over MCP sets the task to Running again", async () => {
  const { task, statusOf } = await withPlan();
  const ready = await task("Add the migration", "Ready");
  const first = await call("start_run", { project: "sandbox", issues: [ready] });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, first.run_id));
  plan.itemsOf(repo).get(ready)!.status = "Ready";
  const again = await call("run_again", { run_id: first.run_id });
  expect(await statusOf(ready)).toBe("Running");
  expect(await planEvents(again.run_id)).toEqual([{ type: "plan.status", payload: { issue: ready, status: "Running", from: "Ready" } }]);
});

test("run_again continues from the branch when the run committed, takes from: scratch, and supersedes the run", async () => {
  const first = await call("start_run", { project: "sandbox", task: "Add a slugify helper" });
  const committed = { nodes: { coder: { executionId: "e1", attempt: 1, output: { status: "done", summary: "Added slugify" } } } };
  await db.update(runs).set({ status: "failed", state: sql`${runs.state} || ${JSON.stringify(committed)}::jsonb` }).where(eq(runs.id, first.run_id));
  const again = await call("run_again", { run_id: first.run_id });
  expect(again).toMatchObject({ status: "queued", from: "branch", supersedes: first.run_id });

  await db.update(runs).set({ status: "failed", state: sql`${runs.state} || ${JSON.stringify(committed)}::jsonb` }).where(eq(runs.id, again.run_id));
  const fresh = await call("run_again", { run_id: again.run_id, from: "scratch" });
  expect(fresh).toMatchObject({ status: "queued", from: "scratch", supersedes: again.run_id });
  expect(await call("get_run", { run_id: again.run_id })).toMatchObject({ status: "cancelled", superseded_by: fresh.run_id });
});

test("setup_plan creates the labels and the Project once, stores the number and is idempotent", async () => {
  const first = await call("setup_plan", { project: "sandbox" });
  expect(first).toMatchObject({ created: true, project: { number: expect.any(Number), title: "sandbox plan", url: expect.stringContaining("/projects/") }, added_date_fields: [] });
  expect([...(plan.labels.get("octo/sample") ?? [])].sort()).toEqual(["epic", "story", "task"]);
  const [stored] = await db.select().from(projects).where(eq(projects.id, projectId));
  expect(stored?.planProjectNumber).toBe(first.project.number);

  plan.labels.get("octo/sample")!.delete("story");
  const again = await call("setup_plan", { project: "sandbox" });
  expect(again).toMatchObject({ created: false, project: { number: first.project.number }, missing_status_options: [] });
  expect(plan.plans.size).toBe(1);
  expect([...plan.labels.get("octo/sample")!].sort()).toEqual(["epic", "story", "task"]);
});

/** A Project of the user's for another repository, with GitHub's default Status options Todo, In Progress and Done. */
async function roadmap() {
  const other = await plan.createProject("octo", { owner: "octo", name: "roadmap" }, "Roadmap");
  plan.plans.get("octo/roadmap")!.project.statusOptions = { Shaping: undefined, Ready: undefined, Running: undefined, "In review": undefined, Done: "opt-done" };
  plan.plans.get("octo/roadmap")!.project.dateFields = { start: undefined, target: undefined };
  return other.number;
}

test("list_github_projects lists the user's Projects, those linked to the repository first, with the Status options each lacks", async () => {
  const other = await roadmap();
  const { number } = await withPlan();
  expect(await call("list_github_projects", { project: "sandbox" })).toEqual([
    { number, title: "sandbox plan", url: expect.stringContaining(`/projects/${number}`), linked: true, missing_status_options: [] },
    { number: other, title: "Roadmap", url: expect.stringContaining(`/projects/${other}`), linked: false, missing_status_options: ["Shaping", "Ready", "Running", "In review"] },
  ]);
});

test("setup_plan with use adopts an existing Project: links it, adds the Status options and date fields it lacks and stores its number", async () => {
  const other = await roadmap();
  const adopted = await call("setup_plan", { project: "sandbox", use: other });
  expect(adopted).toMatchObject({
    created: false,
    project: { number: other, title: "Roadmap" },
    added_status_options: ["Shaping", "Ready", "Running", "In review"],
    missing_status_options: [],
    added_date_fields: ["Start", "Target"],
  });
  expect(plan.plans.get("octo/sample")!.project.dateFields).toEqual({ start: expect.any(String), target: expect.any(String) });
  const [stored] = await db.select().from(projects).where(eq(projects.id, projectId));
  expect(stored?.planProjectNumber).toBe(other);
  expect((await call("list_github_projects", { project: "sandbox" }))[0]).toMatchObject({ number: other, linked: true, missing_status_options: [] });
  expect([...(plan.labels.get("octo/sample") ?? [])].sort()).toEqual(["epic", "story", "task"]);
  expect((await call("setup_plan", { project: "sandbox", use: 99 })).error).toMatch(/already has a plan: GitHub Project #\d+/);
});

test("create_epic creates an issue labelled epic in Shaping in the Project", async () => {
  expect(await call("create_epic", { project: "sandbox", title: "Project management", goal: "See what each task is part of." })).toEqual({
    error: expect.stringContaining("setup_plan"),
  });
  const { number } = await withPlan();
  const epic = await call("create_epic", { project: "sandbox", title: "Project management", goal: "See what each task is part of." });
  expect(epic).toMatchObject({ number: expect.any(Number), url: expect.stringContaining("/issues/"), kind: "epic", status: "Shaping" });
  expect(github.issues.get(epic.number)).toMatchObject({ title: "Project management", body: "## Goal\n\nSee what each task is part of.", labels: ["epic"] });
  expect(await plan.getStatus(repo, number, epic.number)).toBe("Shaping");
});

test("create_story creates a sub-issue of the epic with its acceptance criteria as checkboxes", async () => {
  const { number } = await withPlan();
  const epic = await call("create_epic", { project: "sandbox", title: "Project management", goal: "See what each task is part of." });
  const story = await call("create_story", { project: "sandbox", epic: epic.number, title: "Shaping tools", acceptance: ["setup_plan creates the Project", "Every write asks first"] });
  expect(story).toMatchObject({ number: expect.any(Number), kind: "story", status: "Shaping", parent: epic.number });
  expect(github.issues.get(story.number)).toMatchObject({
    title: "Shaping tools",
    body: "## Acceptance criteria\n\n- [ ] setup_plan creates the Project\n- [ ] Every write asks first",
    labels: ["story"],
  });
  expect(plan.parents.get(story.number)).toBe(epic.number);
  expect(await plan.getStatus(repo, number, story.number)).toBe("Shaping");
  expect(await call("create_story", { project: "sandbox", epic: story.number, title: "Nested", acceptance: ["x"] })).toEqual({ error: expect.stringMatching(/#\d+ is a story, not an epic/) });
});

/** An epic with one story on the sandbox plan, created through the tools. */
async function epicAndStory() {
  const planned = await withPlan();
  const epic = await call("create_epic", { project: "sandbox", title: "Project management", goal: "See what each task is part of." });
  const story = await call("create_story", { project: "sandbox", epic: epic.number, title: "Shaping tools", acceptance: ["Every write asks first"] });
  return { ...planned, epic: epic.number as number, story: story.number as number };
}

test("create_task creates a sub-issue of the story with its blockers linked and refuses a story that is not in the plan", async () => {
  const { number, story } = await epicAndStory();
  const task = await call("create_task", {
    project: "sandbox",
    story,
    title: "Add the migration",
    brief: "Add plan_project_number to projects in packages/db.",
    acceptance: ["The column is nullable"],
    blocked_by: [11],
  });
  expect(task).toMatchObject({ number: expect.any(Number), kind: "task", status: "Shaping", parent: story, blocked_by: [11] });
  expect(github.issues.get(task.number)).toMatchObject({
    title: "Add the migration",
    body: "Add plan_project_number to projects in packages/db.\n\n## Acceptance criteria\n\n- [ ] The column is nullable",
    labels: ["task"],
    blockedBy: [11],
  });
  expect(plan.parents.get(task.number)).toBe(story);
  expect(await plan.getStatus(repo, number, task.number)).toBe("Shaping");
  expect(await call("create_task", { project: "sandbox", story: 12, title: "Elsewhere", brief: "Not under a planned story." })).toEqual({ error: expect.stringContaining("#12 is not in the plan") });
});

test("move_to_ready sets Ready on tasks and refuses an epic, a story, a closed issue and a task without a body", async () => {
  const { number, epic, story, statusOf } = await epicAndStory();
  const task = async (title: string) => (await call("create_task", { project: "sandbox", story, title, brief: `${title} in the code.` })).number as number;
  const first = await task("Add the migration");
  const second = await task("Read the column");
  expect(await call("move_to_ready", { project: "sandbox", issues: [first, second] })).toEqual({ moved: [first, second], status: "Ready" });
  expect([await statusOf(first), await statusOf(second)]).toEqual(["Ready", "Ready"]);

  const closed = await task("Already done");
  github.issues.get(closed)!.state = "closed";
  const empty = (await plan.createIssue(repo, { project: number, title: "No brief", body: "  ", labels: ["task"], parent: story })).number;
  const refusal = async (issue: number) => (await call("move_to_ready", { project: "sandbox", issues: [issue] })).error;
  expect(await refusal(epic)).toMatch(new RegExp(`#${epic} is an epic`));
  expect(await refusal(story)).toMatch(new RegExp(`#${story} is a story`));
  expect(await refusal(closed)).toMatch(new RegExp(`#${closed} is closed`));
  expect(await refusal(empty)).toMatch(new RegExp(`#${empty} has no body`));
  expect(await refusal(11)).toMatch(/#11 is not in the plan/);
  // A refused call moves none of its tasks.
  const third = await task("Write the docs");
  expect((await call("move_to_ready", { project: "sandbox", issues: [third, epic] })).error).toBeDefined();
  expect(await statusOf(third)).toBe("Shaping");
});

test("move_to_shaping refuses a task with an active run", async () => {
  const { story, statusOf } = await epicAndStory();
  const task = async (title: string) => (await call("create_task", { project: "sandbox", story, title, brief: `${title} in the code.` })).number as number;
  const running = await task("Add the migration");
  const waiting = await task("Read the column");
  await call("move_to_ready", { project: "sandbox", issues: [running, waiting] });
  const { run_id } = await call("start_run", { project: "sandbox", issues: [running] });
  expect((await call("move_to_shaping", { project: "sandbox", issues: [running] })).error).toMatch(new RegExp(`#${running} has an active run`));
  expect(await statusOf(running)).toBe("Running");
  expect(await call("move_to_shaping", { project: "sandbox", issues: [waiting] })).toEqual({ moved: [waiting], status: "Shaping" });
  expect(await statusOf(waiting)).toBe("Shaping");
  // Once the run is cancelled, its task is Ready again and can go back to Shaping.
  await call("cancel_run", { run_id });
  expect(await call("move_to_shaping", { project: "sandbox", issues: [running] })).toEqual({ moved: [running], status: "Shaping" });
});

test("plan_issue adds an unplanned issue as a task under the given story", async () => {
  const { story, statusOf } = await epicAndStory();
  expect(await call("plan_issue", { project: "sandbox", issue: 11, story })).toMatchObject({ number: 11, kind: "task", status: "Shaping", parent: story });
  expect(github.issues.get(11)?.labels).toEqual(["task"]);
  expect(plan.parents.get(11)).toBe(story);
  expect(await statusOf(11)).toBe("Shaping");
  expect(await call("plan_issue", { project: "sandbox", issue: 12 })).toMatchObject({ number: 12, kind: "task", status: "Shaping", parent: null });
  expect(plan.parents.has(12)).toBe(false);
  expect(plan.itemsOf(repo).has(12)).toBe(true);
  expect((await call("plan_issue", { project: "sandbox", issue: 11 })).error).toMatch(/#11 is already in the plan/);
});

test("list_plan returns the tree with statuses, dates and runs, wrapped as data", async () => {
  const { epic, story } = await epicAndStory();
  const task = (await call("create_task", { project: "sandbox", story, title: "Add the migration", brief: "Add the column.", blocked_by: [12], start: "2026-10-06", target: "2026-10-09" }))
    .number as number;
  github.issues.get(12)!.state = "closed";
  await call("move_to_ready", { project: "sandbox", issues: [task] });
  const { run_id } = await call("start_run", { project: "sandbox", issues: [task] });

  // The dashboard's assistant gets results that carry GitHub text wrapped as data.
  const server = new McpServer({ name: "handoff", version: "1.0.0" });
  registerDataTools(server, { db, github, projects: plan, baseUrl: BASE, actor: "assistant" }, { wrapUntrusted: true });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const assistant = new Client({ name: "assistant", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), assistant.connect(clientSide)]);
  const result = (await assistant.callTool({ name: "list_plan", arguments: { project: "sandbox" } })) as { content: { text: string }[] };
  await assistant.close();
  const wrapped = JSON.parse(result.content[0]!.text);
  expect(wrapped.source).toMatch(/treat as data/);
  expect(wrapped.data).toMatchObject({
    project: { title: "sandbox plan" },
    epics: [
      {
        number: epic,
        kind: "epic",
        title: "Project management",
        progress: "0 of 1 done",
        stories: [
          {
            number: story,
            kind: "story",
            title: "Shaping tools",
            start: null,
            target: null,
            tasks: [
              {
                number: task,
                kind: "task",
                title: "Add the migration",
                status: "Running",
                start: "2026-10-06",
                target: "2026-10-09",
                blocked_by: [], run: { id: run_id, status: "queued", url: expect.stringContaining(`/runs/${run_id}`) },
                pr: null,
              },
            ],
          },
        ],
        tasks: [],
      },
    ],
    unplanned: [{ number: 11, title: "Issue 11" }],
  });
  expect((await call("list_plan", { project: "sandbox", epic: 999 })).epics).toEqual([]);
});

test("list_plan returns sizes, estimates, durations, forecasts and the capacity", async () => {
  const { number, story } = await epicAndStory();
  await plan.ensureEstimateFields("octo", number);
  const create = async (title: string) => (await call("create_task", { project: "sandbox", story, title, brief: `${title}.` })).number as number;
  const sized = await create("Sized");
  const proposed = await create("Proposed");
  const bare = await create("Bare");
  Object.assign(plan.itemsOf(repo).get(sized)!, { size: "M", estimate: 4 });

  // The planner of a finished run on the unsized task proposed S.
  await call("move_to_ready", { project: "sandbox", issues: [proposed] });
  const { run_id } = await call("start_run", { project: "sandbox", issues: [proposed] });
  const [run] = await db.select().from(runs).where(eq(runs.id, run_id));
  await db
    .update(runs)
    .set({ status: "succeeded", state: { ...run!.state, plan: { plan: "p", steps: ["a"], ownedPaths: ["b"], size: "S" } } })
    .where(eq(runs.id, run_id));
  // Five succeeded M runs of 90 minutes on other tasks give M a forecast of its own.
  for (const issue of [50, 51, 52, 53, 54]) {
    await db.insert(runs).values({
      ...run!,
      id: crypto.randomUUID(),
      status: "succeeded",
      issues: [{ number: issue, title: `#${issue}`, url: `https://github.com/octo/sample/issues/${issue}` }],
      size: "M",
      branchName: `handoff/m-${issue}`,
      startedAt: new Date("2026-10-01T09:00:00Z"),
      finishedAt: new Date("2026-10-01T10:30:00Z"),
    });
  }

  const listed = await call("list_plan", { project: "sandbox" });
  expect(listed.capacity_hours).toBe(6);
  expect(listed.forecasts).toEqual({
    S: { source: "default", minutes: 30, parts: null, cost_usd: null, runs: 0, measured_minutes: null },
    M: { source: "runs", minutes: 90, parts: { agent: 90, queue: 0, waiting: 0 }, cost_usd: 0, runs: 5, measured_minutes: 90 },
    L: { source: "default", minutes: 120, parts: null, cost_usd: null, runs: 0, measured_minutes: null },
  });
  const tasks = listed.epics[0].stories[0].tasks as Record<string, unknown>[];
  expect(tasks.map((t) => [t.number, t.size, t.estimate_hours, t.proposal, t.duration])).toEqual([
    [sized, "M", 4, null, { hours: 4, source: "estimate" }],
    [proposed, null, null, { size: "S", run_id }, { hours: 0.5, source: "proposal" }],
    [bare, null, null, null, null],
  ]);
});

/** The Start and Target an issue has on the sandbox plan. */
const datesOf = (issue: number) => {
  const item = plan.itemsOf(repo).get(issue);
  return { start: item?.start, target: item?.target };
};

test("schedule sets Start and Target on epics, stories and tasks and lists old and new dates in its summary", async () => {
  const { epic, story } = await epicAndStory();
  const task = (await call("create_task", { project: "sandbox", story, title: "Add the migration", brief: "Add the column." })).number as number;
  plan.itemsOf(repo).get(task)!.start = "2026-10-01";

  const result = await call("schedule", {
    project: "sandbox",
    items: [
      { issue: epic, start: "2026-10-05", target: "2026-10-30" },
      { issue: story, target: "2026-10-16" },
      { issue: task, start: "2026-10-06", target: "2026-10-09" },
    ],
  });

  expect([datesOf(epic), datesOf(story), datesOf(task)]).toEqual([
    { start: "2026-10-05", target: "2026-10-30" },
    { start: undefined, target: "2026-10-16" },
    { start: "2026-10-06", target: "2026-10-09" },
  ]);
  expect(result.scheduled).toEqual([
    { issue: epic, kind: "epic", title: "Project management", start: { from: null, to: "2026-10-05" }, target: { from: null, to: "2026-10-30" } },
    { issue: story, kind: "story", title: "Shaping tools", target: { from: null, to: "2026-10-16" } },
    { issue: task, kind: "task", title: "Add the migration", start: { from: "2026-10-01", to: "2026-10-06" }, target: { from: null, to: "2026-10-09" } },
  ]);
  expect(result.summary).toContain(`#${task} Add the migration: Start 2026-10-01 to 2026-10-06, Target none to 2026-10-09`);

  // null clears a date.
  await call("schedule", { project: "sandbox", items: [{ issue: task, start: null }] });
  expect(datesOf(task)).toEqual({ start: undefined, target: "2026-10-09" });
});

test("schedule refuses a Target before its Start, a malformed date and an issue outside the Project", async () => {
  const { story } = await epicAndStory();
  const task = (await call("create_task", { project: "sandbox", story, title: "Add the migration", brief: "Add the column." })).number as number;
  plan.itemsOf(repo).get(task)!.start = "2026-10-12";
  const refused = async (items: unknown[]) => (await call("schedule", { project: "sandbox", items })).error as string;

  // Each refusal changes nothing, not even the items before the one refused.
  expect(await refused([{ issue: story, target: "2026-10-30" }, { issue: task, start: "2026-10-09", target: "2026-10-06" }])).toMatch(`#${task}: Target 2026-10-06 is before its Start 2026-10-09`);
  // A Target alone is checked against the Start the task keeps.
  expect(await refused([{ issue: task, target: "2026-10-06" }])).toMatch(`#${task}: Target 2026-10-06 is before its Start 2026-10-12`);
  expect(await refused([{ issue: task, start: "10/06/2026" }])).toMatch(/start/i);
  expect(await refused([{ issue: task, start: "2026-02-31" }])).toMatch(/start/i);
  expect(await refused([{ issue: story, target: "2026-10-30" }, { issue: 11, start: "2026-10-06" }])).toMatch("#11 is not in the plan");
  expect(datesOf(story)).toEqual({ start: undefined, target: undefined });
  expect(datesOf(task)).toEqual({ start: "2026-10-12", target: undefined });
});

test("schedule on a Project without date fields names setup_plan", async () => {
  const { story } = await epicAndStory();
  plan.plans.get("octo/sample")!.project.dateFields = { start: undefined, target: undefined };
  expect((await call("schedule", { project: "sandbox", items: [{ issue: story, target: "2026-10-30" }] })).error).toMatch(/no Start and Target date fields\. Run setup_plan/);
  expect((await call("create_task", { project: "sandbox", story, title: "Dated", brief: "A brief.", start: "2026-10-06" })).error).toMatch(/setup_plan/);
  expect([...plan.itemsOf(repo).values()].some((i) => i.start || i.target)).toBe(false);

  // setup_plan adds the missing fields to the plan's Project, and schedule then works.
  await call("setup_plan", { project: "sandbox" });
  expect(await call("schedule", { project: "sandbox", items: [{ issue: story, target: "2026-10-30" }] })).toMatchObject({ scheduled: [{ issue: story }] });
});

test("create_task with start and target sets them", async () => {
  const { story } = await epicAndStory();
  const task = await call("create_task", { project: "sandbox", story, title: "Add the migration", brief: "Add the column.", start: "2026-10-06", target: "2026-10-09" });
  expect(task).toMatchObject({ kind: "task", start: "2026-10-06", target: "2026-10-09" });
  expect(datesOf(task.number)).toEqual({ start: "2026-10-06", target: "2026-10-09" });
  const dated = await call("create_story", { project: "sandbox", epic: plan.parents.get(story), title: "Dates", acceptance: ["Bars show"], target: "2026-10-30" });
  expect(datesOf(dated.number)).toEqual({ start: undefined, target: "2026-10-30" });
  const count = github.issues.size;
  expect((await call("create_task", { project: "sandbox", story, title: "Backwards", brief: "A brief.", start: "2026-10-09", target: "2026-10-06" })).error).toMatch(/Target 2026-10-06 is before its Start 2026-10-09/);
  expect(github.issues.size).toBe(count);
});

/** A story with a task dated Oct 4 and an undated task, on a plan with the Size and Estimate fields. */
async function sizingPlan() {
  const { number, epic, story } = await epicAndStory();
  await plan.ensureEstimateFields("octo", number);
  const create = async (title: string, dates: Record<string, string> = {}) => (await call("create_task", { project: "sandbox", story, title, brief: `${title}.`, ...dates })).number as number;
  const dated = await create("Dated", { start: "2026-10-04", target: "2026-10-04" });
  const undated = await create("Undated");
  return { number, epic, story, dated, undated };
}

/** The Size and Estimate an issue has on the sandbox plan. */
const sizeOf = (issue: number) => {
  const item = plan.itemsOf(repo).get(issue);
  return { size: item?.size, estimate: item?.estimate };
};

test("set_size writes sizes and estimates and moves the Target of a dated task", async () => {
  const { dated, undated } = await sizingPlan();
  const writes = vi.spyOn(plan, "setManyPlanFields");

  // 1.5 days at 6 hours a day is 9 hours: from Oct 4 the dated task ends on Oct 5.
  const result = await call("set_size", { project: "sandbox", items: [{ issue: dated, estimate: "1.5d" }, { issue: undated, size: "M" }] });
  expect(result.sized).toEqual([
    { issue: dated, title: "Dated", estimate: { from: null, to: 9 }, target: { from: "2026-10-04", to: "2026-10-05" } },
    { issue: undated, title: "Undated", size: { from: null, to: "M" } },
  ]);
  expect(result.summary).toBe(`#${dated} Dated: estimate none to 9h, Target 2026-10-04 to 2026-10-05; #${undated} Undated: size none to M`);
  expect(writes).toHaveBeenCalledTimes(1);
  expect([sizeOf(dated), datesOf(dated), sizeOf(undated), datesOf(undated)]).toEqual([
    { size: undefined, estimate: 9 },
    { start: "2026-10-04", target: "2026-10-05" },
    { size: "M", estimate: undefined },
    { start: undefined, target: undefined },
  ]);

  // 0 clears the estimate: S's default of 30 minutes ends on Oct 4 again. A number is hours.
  await call("set_size", { project: "sandbox", items: [{ issue: dated, size: "S", estimate: 0 }, { issue: undated, estimate: 2 }] });
  expect([sizeOf(dated), datesOf(dated), sizeOf(undated)]).toEqual([
    { size: "S", estimate: undefined },
    { start: "2026-10-04", target: "2026-10-04" },
    { size: "M", estimate: 2 },
  ]);
});

test("set_size refuses an epic, an issue outside the plan, an unknown estimate and a Project without the fields", async () => {
  const { epic, story, dated, undated } = await sizingPlan();
  const refused = async (items: unknown[]) => (await call("set_size", { project: "sandbox", items })).error as string;

  // Each refusal writes nothing, not even the tasks before the one refused.
  expect(await refused([{ issue: undated, size: "M" }, { issue: epic, size: "M" }])).toBe(`#${epic} is an epic. Only tasks have a size; stories and epics sum their tasks.`);
  expect(await refused([{ issue: undated, size: "M" }, { issue: story, estimate: "3h" }])).toBe(`#${story} is a story. Only tasks have a size; stories and epics sum their tasks.`);
  expect(await refused([{ issue: undated, size: "M" }, { issue: 11, size: "S" }])).toBe("#11 is not in the plan of sandbox. Add it with plan_issue first.");
  expect(await refused([{ issue: undated, size: "M" }, { issue: dated, estimate: "3 weeks" }])).toBe(`#${dated}: "3 weeks" is not an estimate. Use hours or days, like 3h or 2d.`);
  expect(await refused([{ issue: dated, estimate: 1001 }])).toBe(`#${dated}: An estimate is hours from 0 to 1000.`);
  expect([sizeOf(undated), sizeOf(dated), datesOf(dated)]).toEqual([
    { size: undefined, estimate: undefined },
    { size: undefined, estimate: undefined },
    { start: "2026-10-04", target: "2026-10-04" },
  ]);

  plan.plans.get("octo/sample")!.project.estimateFields = undefined;
  expect(await refused([{ issue: undated, size: "M" }])).toMatch(/has no Size and no Estimate field\. .*run setup_plan/);
  expect(sizeOf(undated)).toEqual({ size: undefined, estimate: undefined });
});

test("arrange_plan returns placements and the tasks it left out, and writes nothing", async () => {
  const { number, story } = await epicAndStory();
  await plan.ensureEstimateFields("octo", number);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const tomorrow = addDays(today, 1);
  const create = async (title: string, parent: number, fields: Record<string, unknown> = {}) =>
    (await call("create_task", { project: "sandbox", story: parent, title, brief: `${title}.`, ...fields })).number as number;

  // Another epic holds 4 hours planned today, which counts even when arrange_plan looks at the first epic only.
  const other = await call("create_epic", { project: "sandbox", title: "Other work", goal: "Elsewhere." });
  const otherStory = (await call("create_story", { project: "sandbox", epic: other.number, title: "Elsewhere", acceptance: ["x"] })).number as number;
  const planned = await create("Planned", otherStory, { start: today, target: today });
  // In the first epic: 2 hours, then an M (1 hour by default) that waits for them, and a task with no size.
  const first = await create("First", story);
  const second = await create("Second", story, { blocked_by: [first] });
  const bare = await create("Bare", story);
  // An unscheduled S in the other epic, placed only when arrange_plan looks at the whole plan.
  const loose = await create("Loose", otherStory);
  Object.assign(plan.itemsOf(repo).get(planned)!, { estimate: 4 });
  Object.assign(plan.itemsOf(repo).get(first)!, { estimate: 2 });
  Object.assign(plan.itemsOf(repo).get(second)!, { size: "M" });
  Object.assign(plan.itemsOf(repo).get(loose)!, { size: "S" });
  const before = structuredClone([...plan.itemsOf(repo).entries()]);
  const writes = [vi.spyOn(plan, "setManyPlanFields"), vi.spyOn(plan, "setPlanFields"), vi.spyOn(plan, "setDates")];

  const arranged = await call("arrange_plan", { project: "sandbox", epic: (await call("list_plan", { project: "sandbox" })).epics.find((e: { title: string }) => e.title === "Project management").number });
  expect(arranged).toEqual({
    today,
    capacity_hours: 6,
    placements: [
      { issue: first, title: "First", start: today, target: today, hours: 2 },
      { issue: second, title: "Second", start: tomorrow, target: tomorrow, hours: 1 },
    ],
    left_out: [{ issue: bare, title: "Bare", reason: "needs a size" }],
  });

  // Without an epic, every unscheduled task of the plan is placed: the S after the M tomorrow.
  const all = await call("arrange_plan", { project: "sandbox" });
  expect(all.placements.map((p: { issue: number; start: string }) => [p.issue, p.start])).toEqual([
    [first, today],
    [second, tomorrow],
    [loose, tomorrow],
  ]);
  for (const write of writes) expect(write).not.toHaveBeenCalled();
  expect([...plan.itemsOf(repo).entries()]).toEqual(before);
});

test("create_task with a size sets it", async () => {
  const { number, story } = await epicAndStory();
  await plan.ensureEstimateFields("octo", number);
  const task = await call("create_task", { project: "sandbox", story, title: "Sized", brief: "A brief.", size: "M" });
  expect(task).toMatchObject({ kind: "task", status: "Shaping", size: "M" });
  expect(sizeOf(task.number)).toEqual({ size: "M", estimate: undefined });
  expect(toolSpec("create_task").summarize({ project: "sandbox", story, title: "Sized", brief: "A brief.", size: "M" })).toBe(`Create task 'Sized' under story #${story} in sandbox, size M`);

  // A Project without the fields refuses before the issue exists.
  plan.plans.get("octo/sample")!.project.estimateFields = undefined;
  const count = github.issues.size;
  expect((await call("create_task", { project: "sandbox", story, title: "Unsized", brief: "A brief.", size: "S" })).error).toMatch(/no Size and no Estimate field\. .*run setup_plan/);
  expect(github.issues.size).toBe(count);
});

test("every shaping tool refuses with the scope sentence when the Projects port is missing", async () => {
  await withPlan();
  const server = createHandoffMcpServer({ db, github, projects: undefined, baseUrl: BASE });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const without = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), without.connect(clientSide)]);
  const calls: [string, Record<string, unknown>][] = [
    ["list_github_projects", {}],
    ["setup_plan", {}],
    ["setup_plan", { use: 3 }],
    ["list_plan", {}],
    ["create_epic", { title: "Project management", goal: "A plan." }],
    ["create_story", { epic: 1, title: "Shaping tools", acceptance: ["x"] }],
    ["create_task", { story: 2, title: "Add the migration", brief: "Add it." }],
    ["move_to_ready", { issues: [3] }],
    ["move_to_shaping", { issues: [3] }],
    ["plan_issue", { issue: 11 }],
    ["schedule", { items: [{ issue: 3, start: "2026-10-06" }] }],
    ["set_size", { items: [{ issue: 3, size: "M" }] }],
    ["arrange_plan", {}],
  ];
  for (const [name, args] of calls) {
    const result = (await without.callTool({ name, arguments: { project: "sandbox", ...args } })) as { content: { text: string }[]; isError?: boolean };
    expect({ name, isError: result.isError, text: result.content[0]?.text }).toEqual({ name, isError: true, text: expect.stringContaining("The plan needs GITHUB_TOKEN, a classic token with the project scope") });
  }
  await without.close();
});

test("run_again over MCP starts a task its failed run left in Running", async () => {
  const { task, statusOf } = await withPlan();
  const ready = await task("Add the migration", "Ready");
  const first = await call("start_run", { project: "sandbox", issues: [ready] });
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, first.run_id));
  const again = await call("run_again", { run_id: first.run_id });
  expect(again).toMatchObject({ run_id: expect.any(String), status: "queued" });
  expect(await statusOf(ready)).toBe("Running");
});

test("start_scheduler refuses a project without a plan and names setup_plan", async () => {
  const refused = await call("start_scheduler", { project: "sandbox" });
  expect(refused).toEqual({ error: expect.stringContaining("setup_plan") });
  expect(refused.error).toMatch(/^sandbox has no plan/);
  expect(await db.select().from(projectSchedulers)).toEqual([]);
});

/** The sandbox's GitHub Project, to give it a Priority field. */
const sandboxProject = () => [...plan.plans.values()][0]!.project;
const schedulerRow = async () => (await db.select().from(projectSchedulers).where(eq(projectSchedulers.projectId, projectId)))[0];
const schedulerLog = async () =>
  (await db.select({ type: schedulerEvents.type, payload: schedulerEvents.payload }).from(schedulerEvents).where(eq(schedulerEvents.projectId, projectId)).orderBy(schedulerEvents.id));

test("start_scheduler stores max_runs, order and graph, and resumes a paused scheduler", async () => {
  await withPlan();
  sandboxProject().priorityOptions = ["P0", "P1"];
  // First turned on, it takes the defaults: one run, Project order, the project's default graph.
  expect(await call("start_scheduler", { project: "sandbox" })).toMatchObject({ state: "on", max_runs: 1, order: "project", graph: "linear" });
  expect(await schedulerRow()).toMatchObject({ enabled: true, maxRuns: 1, order: "project", graphName: "linear", pausedAt: null });
  await saveGraphVersion(db, { projectId, name: "fast", document: linear });

  expect(await call("start_scheduler", { project: "sandbox", max_runs: 3, order: "priority", graph: "fast" })).toMatchObject({ state: "on", max_runs: 3, order: "priority", graph: "fast" });
  expect(await schedulerRow()).toMatchObject({ enabled: true, maxRuns: 3, order: "priority", graphName: "fast" });
  expect((await call("start_scheduler", { project: "sandbox", graph: "nope" })).error).toMatch(/sandbox has no graph nope/);

  // Paused by itself after failed starts, it resumes with the stored settings and a clean count.
  await db.update(projectSchedulers).set({ pausedAt: new Date(), pausedBy: "scheduler", pauseReason: "3 starts failed in a row.", startFailures: 3 }).where(eq(projectSchedulers.projectId, projectId));
  expect(await call("start_scheduler", { project: "sandbox" })).toMatchObject({ state: "on", max_runs: 3, order: "priority", graph: "fast" });
  expect(await schedulerRow()).toMatchObject({ enabled: true, pausedAt: null, pausedBy: null, pauseReason: null, startFailures: 0, maxRuns: 3, graphName: "fast" });

  const settings = (maxRuns: number, order: string, graphName: string) => ({ maxRuns, order, graphName, skipLabel: "human" });
  expect(await schedulerLog()).toEqual([
    { type: "scheduler.started", payload: { by: "claude-code", settings: settings(1, "project", "linear") } },
    { type: "scheduler.changed", payload: { by: "claude-code", from: settings(1, "project", "linear"), to: settings(3, "priority", "fast") } },
    { type: "scheduler.resumed", payload: { by: "claude-code" } },
  ]);
});

test("start_scheduler refuses priority order on a Project without a Priority field", async () => {
  await withPlan();
  const refused = await call("start_scheduler", { project: "sandbox", order: "priority" });
  expect(refused.error).toBe(`GitHub Project #${sandboxProject().number} has no Priority field, so the scheduler cannot order tasks by priority. Add a single select field named Priority to the Project, or use Project order.`);
  expect(await schedulerRow()).toBeUndefined();
  expect(await call("start_scheduler", { project: "sandbox", order: "project" })).toMatchObject({ state: "on", order: "project" });
});

test("start_scheduler refuses without access to GitHub Projects and refuses a demo project", async () => {
  await withPlan();
  plan.scopesAnswer = { project: false, classic: true };
  expect((await call("start_scheduler", { project: "sandbox" })).error).toBe(
    "The scheduler reads Ready tasks from GitHub Projects. GITHUB_TOKEN lacks the project scope. Run gh auth refresh -s project, then set GITHUB_TOKEN=$(gh auth token).",
  );
  plan.scopesAnswer = { project: true, classic: true };
  await db.update(projects).set({ isDemo: true }).where(eq(projects.id, projectId));
  expect((await call("start_scheduler", { project: "sandbox" })).error).toBe("sandbox is a demo project: its runs are simulated, so the scheduler cannot start any.");
  expect(await schedulerRow()).toBeUndefined();
});

test("pause_scheduler stops new starts and leaves active runs alone", async () => {
  const { task } = await withPlan();
  const mine = await task("Add the migration", "Ready");
  await task("Add the endpoint", "Ready");
  const { run_id } = await call("start_run", { project: "sandbox", issues: [mine] });
  await call("start_scheduler", { project: "sandbox", max_runs: 2 });

  expect(await call("pause_scheduler", { project: "sandbox", reason: "Lunch" })).toMatchObject({ state: "paused", reason: "Lunch" });
  expect(await schedulerRow()).toMatchObject({ enabled: true, pausedBy: "person", pauseReason: "Lunch", pausedAt: expect.any(Date) });
  // Pausing again changes nothing.
  expect(await call("pause_scheduler", { project: "sandbox" })).toMatchObject({ state: "paused", reason: "Lunch" });
  expect((await schedulerLog()).filter((e) => e.type === "scheduler.paused")).toEqual([{ type: "scheduler.paused", payload: { by: "claude-code", reason: "Lunch" } }]);

  // A check while paused starts nothing, though a slot is free and a Ready task waits; the active run goes on.
  expect(await checkProject({ db, github, projects: plan, owner: "worker-1" }, projectId)).toBeUndefined();
  expect(await db.select({ id: runs.id, status: runs.status }).from(runs)).toEqual([{ id: run_id, status: "queued" }]);

  // Resumed, the next check starts the waiting task.
  await call("start_scheduler", { project: "sandbox" });
  expect(await checkProject({ db, github, projects: plan, owner: "worker-1" }, projectId)).toMatchObject({ state: "running" });
});

test("get_scheduler reports holds with their links, active runs of max_runs, Claude slots and the next candidates with skip reasons", async () => {
  const { task } = await withPlan();
  const planUrl = `${BASE}/projects/${projectId}/plan`;
  expect(await call("get_scheduler", { project: "sandbox" })).toMatchObject({ state: "off", url: planUrl });

  const first = await task("Add the migration", "Ready");
  const second = await task("Add the endpoint", "Ready");
  const blocked = await task("Add the page", "Ready");
  github.issues.get(blocked)!.blockedBy = [11];
  const manual = (await call("start_run", { project: "sandbox", issues: [await task("Fix the header", "Ready")] })).run_id as string;
  await registerWorker(db, { id: "worker-1", hostname: "box", caps: { cli: 2, shell: 4 } });
  await call("start_scheduler", { project: "sandbox", max_runs: 3 });
  const started = (await checkProject({ db, github, projects: plan, owner: "worker-1" }, projectId))!.started[0]!.runId;

  // The run a person started failed and holds; the scheduler's run waits for a plan review, which does not hold, and holds its coder on overlap.
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, manual));
  await db.transaction((tx) => appendEvents(tx, manual, [{ type: "run.failed", payload: { nodeKey: "coder-1" } }]));
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, started));
  const gate = await seedExecution(db, started, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  await db.insert(questions).values({ runId: started, nodeExecutionId: gate.id, question: "Review the plan from planner", options: ["approve", "changes"], context: { review: { markdown: "# Plan" } } });
  const coder = await seedExecution(db, started, { nodeKey: "coder", status: "waiting", waitKey: `overlap:${projectId}` });
  await db.transaction((tx) => appendEvents(tx, started, [{ type: "run.overlap_held", payload: { nodeKey: "coder", runId: manual, paths: ["src/a.ts"] }, nodeExecutionId: coder.id }]));

  const status = await call("get_scheduler", { project: "sandbox" });
  const short = (id: string) => id.slice(0, 8);
  expect(status).toMatchObject({
    state: "held",
    settings: { max_runs: 3, order: "project", graph: "linear", skip_label: "human" },
    summary: "1 of 3 runs active, 2 Claude slots",
    active: 1,
    claude_slots: 2,
    active_runs: [{ id: started, status: "waiting", started_by: "scheduler", issues: [first], url: `${BASE}${runPath(projectId, started)}` }],
    holds: [{ kind: "failed", run_id: manual, text: `Run ${short(manual)} failed at coder-1`, url: `${BASE}${runPath(projectId, manual)}` }],
    overlap_held: [{ run_id: started, node: "coder", waits_for: manual, paths: ["src/a.ts"], text: `Run ${short(started)} waits before coder: shares src/a.ts with run ${short(manual)}`, url: `${BASE}${runPath(projectId, started)}` }],
    next: [{ number: second, title: "Add the endpoint" }],
    skipped: [{ number: blocked, title: "Add the page", reason: "blocked by #11" }],
    checked_at: expect.any(String),
    url: planUrl,
  });
  expect(status.events.map((e: { type: string }) => e.type)).toEqual(["scheduler.started", "scheduler.skipped", "scheduler.run_started"]);
  expect(status.events[2]).toMatchObject({ payload: { runId: started, issue: first, place: 1 }, at: expect.any(String) });

  // Without a live worker there is no Claude slot to report; paused, it says who paused it and why.
  await db.update(workers).set({ stoppedAt: new Date() });
  await call("pause_scheduler", { project: "sandbox", reason: "Lunch" });
  expect(await call("get_scheduler", { project: "sandbox" })).toMatchObject({ state: "paused", paused: { by: "person", reason: "Lunch" }, summary: "1 of 3 runs active, no worker running", claude_slots: null });
});

test("get_scheduler says a scheduler just turned on has not checked yet and when it first checks", async () => {
  await withPlan();
  await call("start_scheduler", { project: "sandbox" });
  const status = await call("get_scheduler", { project: "sandbox" });
  expect(status).toMatchObject({ checked_at: null, next: [], check: expect.stringMatching(/^Not checked yet; first check (due now|in about \d+ s)$/) });

  await checkProject({ db, github, projects: plan, owner: "worker-1" }, projectId);
  expect((await call("get_scheduler", { project: "sandbox" })).check).toMatch(/^Checked \d+ s ago$/);
});

test("stop_scheduler turns the scheduler off, and start_scheduler takes a skip label and turns it on again as the first time", async () => {
  await withPlan();
  await call("start_scheduler", { project: "sandbox", max_runs: 2, skip_label: "manual" });
  expect(await schedulerRow()).toMatchObject({ enabled: true, maxRuns: 2, skipLabel: "manual" });

  expect(await call("stop_scheduler", { project: "sandbox" })).toEqual({ state: "off", url: `${BASE}/projects/${projectId}/plan` });
  expect(await call("get_scheduler", { project: "sandbox" })).toMatchObject({ state: "off" });
  await call("start_scheduler", { project: "sandbox", skip_label: null });
  expect(await schedulerRow()).toMatchObject({ enabled: true, maxRuns: 2, skipLabel: null });
  expect((await schedulerLog()).map((e) => e.type)).toEqual(["scheduler.started", "scheduler.stopped", "scheduler.started"]);
});

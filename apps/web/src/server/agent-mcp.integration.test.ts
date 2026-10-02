import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { and, appendEvents, eq, events, nodeExecutions, permissionRequests, projects, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { CATALOG } from "../lib/assistant/catalog";
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

test("what needs attention comes with links to the dashboard", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.update(nodeExecutions).set({ status: "failed" }).where(eq(nodeExecutions.runId, run_id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run_id));
  expect(await call("list_attention")).toEqual([expect.objectContaining({ kind: "failed", title: "sandbox: run failed at planner", url: expect.stringMatching(new RegExp(`^${BASE}/projects/[0-9a-f-]+/runs/${run_id}$`)) })]);
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

test("a finished run can be dismissed from what needs attention; other items cannot", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.transaction((tx) => appendEvents(tx, run_id, [{ type: "run.finish", payload: { notify: true } }]));
  expect((await call("list_attention")).map((i: { id: string }) => i.id)).toEqual([`finished:${run_id}`]);
  expect(await call("dismiss_attention", { item_id: `finished:${run_id}` })).toEqual({ dismissed: true });
  expect(await call("list_attention")).toEqual([]);
  expect(await call("dismiss_attention", { item_id: "question:abc" })).toEqual({ error: expect.stringMatching(/only finished runs/i) });
});

test("a run stopped by a loop that ran out says so, asks for a decision, and goes on when given one", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  const [planner] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.runId, run_id));
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.id, planner!.id));
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
  expect((await call("get_run", { run_id })).stuck).toEqual({ node: "planner", loop: "planner->planner", attempts: 3 });
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

test("answer_permission cannot always allow", async () => {
  expect((await call("answer_permission", { request_id: "x", decision: "always" })).error).toBeDefined();
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
  expect(await planEvents(run_id)).toEqual([{ type: "plan.status", payload: { issue: ready, status: "Running" } }]);
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
  expect(await planEvents(again.run_id)).toEqual([{ type: "plan.status", payload: { issue: ready, status: "Running" } }]);
});

test("setup_plan creates the labels and the Project once, stores the number and is idempotent", async () => {
  const first = await call("setup_plan", { project: "sandbox" });
  expect(first).toMatchObject({ created: true, project: { number: expect.any(Number), title: "sandbox plan", url: expect.stringContaining("/projects/") } });
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

test("setup_plan with use adopts an existing Project: links it, adds the Status options it lacks and stores its number", async () => {
  const other = await roadmap();
  const adopted = await call("setup_plan", { project: "sandbox", use: other });
  expect(adopted).toMatchObject({ created: false, project: { number: other, title: "Roadmap" }, added_status_options: ["Shaping", "Ready", "Running", "In review"], missing_status_options: [] });
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

test("list_plan returns the tree with statuses and runs, wrapped as data", async () => {
  const { epic, story } = await epicAndStory();
  const task = (await call("create_task", { project: "sandbox", story, title: "Add the migration", brief: "Add the column.", blocked_by: [12] })).number as number;
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
            tasks: [{ number: task, kind: "task", title: "Add the migration", status: "Running", blocked_by: [], run: { id: run_id, status: "queued", url: expect.stringContaining(`/runs/${run_id}`) }, pr: null }],
          },
        ],
        tasks: [],
      },
    ],
    unplanned: [{ number: 11, title: "Issue 11" }],
  });
  expect((await call("list_plan", { project: "sandbox", epic: 999 })).epics).toEqual([]);
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

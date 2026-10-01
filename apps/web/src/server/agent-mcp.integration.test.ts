import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, afterEach, beforeEach, expect, test } from "vitest";
import { and, appendEvents, eq, nodeExecutions, questions, runs } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createHandoffMcpServer } from "./agent-mcp";
import { createProject, saveGraphVersion } from "./graphs";

const db = createTestDb();
const BASE = "http://localhost:3000";
let client: Client;
let github: FakeGitHub;

beforeEach(async () => {
  await truncateAll(db);
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  github = new FakeGitHub();
  for (const number of [11, 12]) {
    github.issues.set(number, { number, title: `Issue ${number}`, url: `https://github.com/octo/sample/issues/${number}`, body: `Body ${number}`, state: "open", updatedAt: `2026-09-30T0${number - 10}:00:00Z` });
  }
  const server = createHandoffMcpServer({ db, github, baseUrl: BASE });
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

test("the tools are listed, and read-only ones say so", async () => {
  const { tools } = await client.listTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  expect(Object.keys(byName).sort()).toEqual(
    ["add_project", "answer_question", "cancel_run", "dismiss_attention", "get_project", "get_run", "list_attention", "list_backlog", "list_library", "list_projects", "list_runs", "repair_run", "resolve_loop", "run_again", "start_run"].sort(),
  );
  expect(byName.list_backlog?.annotations?.readOnlyHint).toBe(true);
  expect(byName.cancel_run?.annotations?.destructiveHint).toBe(true);
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
  expect(started).toMatchObject({ run_id: expect.any(String), status: "queued", url: expect.stringMatching(new RegExp(`^${BASE}/runs/`)) });
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
  expect(await call("list_attention")).toEqual([expect.objectContaining({ kind: "failed", title: "sandbox: run failed at planner", url: `${BASE}/runs/${run_id}` })]);
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
    expect.objectContaining({ id: `stuck:${run_id}`, kind: "failed", title: "sandbox: planner ran out of rounds", url: `${BASE}/runs/${run_id}` }),
  ]);
  expect((await call("get_run", { run_id })).stuck).toEqual({ node: "planner", loop: "planner->planner", attempts: 3 });
  expect(await call("resolve_loop", { run_id, action: "continue" })).toMatchObject({ resolved: "continue" });
  const steps = (await call("get_run", { run_id })).steps.map((s: { node: string }) => s.node);
  expect(steps).toEqual(["planner", "coder"]);
  expect((await call("get_run", { run_id })).stuck).toBeNull();
});

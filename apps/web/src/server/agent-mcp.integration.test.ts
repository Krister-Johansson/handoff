import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { and, appendEvents, createNotification, eq, events, nodeExecutions, permissionRequests, planPins, projects, projectSchedulers, questions, registerWorker, runs, schedulerEvents, sql, workers } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { checkProject } from "@handoff/engine/backlog-scheduler";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { CATALOG, toolSpec } from "../lib/assistant/catalog";
import { runPath } from "../lib/paths";
import { addDays } from "../lib/plan/timeline-scale";
import { McpServer } from "@modelcontextprotocol/server";
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

test("a call to a tool handoff does not have is refused as invalid params, not answered as a failed tool", async () => {
  await expect(client.callTool({ name: "no_such_tool", arguments: {} })).rejects.toMatchObject({ code: -32602, message: expect.stringMatching(/^Tool no_such_tool not found/) });
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

/** Each view of MCP Apps by its ui:// resource, with the tools whose results it draws. A tool links to one view. */
const VIEWS = [
  { uri: "ui://handoff/run-card.html", name: "Run card", tools: ["get_run"] },
  { uri: "ui://handoff/needs-you.html", name: "Needs you", tools: ["list_attention", "list_inbox"] },
  { uri: "ui://handoff/permission-card.html", name: "Permission card", tools: ["answer_permission"] },
  { uri: "ui://handoff/question-card.html", name: "Question card", tools: ["answer_question"] },
  { uri: "ui://handoff/plan-list.html", name: "Plan list", tools: ["list_plan"] },
];

test("each tool with a view links to its ui:// resource, and no other tool has one", async () => {
  const { tools } = await client.listTools();
  for (const view of VIEWS) {
    for (const name of view.tools) expect(tools.find((t) => t.name === name)?._meta, name).toEqual({ ui: { resourceUri: view.uri }, "ui/resourceUri": view.uri });
  }
  expect(
    tools
      .filter((t) => t._meta?.ui)
      .map((t) => t.name)
      .sort(),
  ).toEqual(VIEWS.flatMap((v) => v.tools).sort());
});

test("each view is a ui:// resource served as one HTML document with the MCP App MIME type that loads nothing from elsewhere", async () => {
  const { resources } = await client.listResources();
  expect(resources.map((r) => ({ uri: r.uri, name: r.name, mimeType: r.mimeType }))).toEqual(VIEWS.map((v) => ({ uri: v.uri, name: v.name, mimeType: "text/html;profile=mcp-app" })));
  for (const view of VIEWS) {
    const { contents } = await client.readResource({ uri: view.uri });
    expect(contents, view.uri).toEqual([
      {
        uri: view.uri,
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringMatching(/^<!doctype html>/i),
        _meta: { ui: { csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] }, prefersBorder: false } },
      },
    ]);
  }
});

test("the results of tools with a view stay one block of JSON text, which clients without MCP Apps show", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", issues: [11] });
  for (const [name, args] of [
    ["get_run", { run_id }],
    ["list_attention", {}],
    ["list_inbox", {}],
  ] as const) {
    const result = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; structuredContent?: unknown };
    expect(result.content, name).toHaveLength(1);
    expect(result.content[0]).toEqual({ type: "text", text: JSON.stringify(JSON.parse(result.content[0]!.text), null, 2) });
    expect(result.structuredContent).toBeUndefined();
  }
});

test("the assistant's tools carry no view, since the dashboard draws its own cards", async () => {
  const server = new McpServer({ name: "handoff", version: "1.0.0" });
  registerDataTools(server, { db, github, projects: plan, baseUrl: BASE, actor: "assistant" }, { wrapUntrusted: true });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const assistant = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverSide), assistant.connect(clientSide)]);
  const { tools } = await assistant.listTools();
  expect(tools.find((t) => t.name === "get_run")?._meta).toBeUndefined();
  await assistant.close();
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

test("unlink_issue takes an issue off a run, drops its Closes line from the pull request and returns it to the backlog", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", issues: [11, 12] });
  const [run] = await db.select().from(runs).where(eq(runs.id, run_id));
  const pr = await github.createPr({ owner: "octo", name: "sample" }, { head: run!.branchName, base: "main", title: "Two issues", body: "Closes #11\nCloses #12\n" });
  await db.update(runs).set({ prNumber: pr.number }).where(eq(runs.id, run_id));
  expect(toolSpec("unlink_issue")).toMatchObject({ confirm: true, readOnly: false });

  expect(await call("unlink_issue", { run_id, issue: 12 })).toEqual({ unlinked: 12, pr: pr.number, status: null, url: `${BASE}${runPath(projectId, run_id)}` });

  expect((await call("get_run", { run_id })).issues.map((i: { number: number }) => i.number)).toEqual([11]);
  expect(github.prs.get(pr.number)!.body).toBe("Closes #11\n");
  expect((await call("list_backlog", { project: "sandbox" })).map((i: { number: number }) => i.number)).toEqual([12]);
  const [event] = await db.select().from(events).where(and(eq(events.runId, run_id), eq(events.type, "run.issue_unlinked")));
  expect(event!.payload).toEqual({ issue: 12, by: "claude-code", pr: pr.number });
  expect(await call("unlink_issue", { run_id, issue: 12 })).toEqual({ error: `Run ${run_id} does not link #12.` });
});

test("repair_run allows the files it is given outside the plan for the repaired step", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.update(nodeExecutions).set({ status: "failed", error: { code: "paths_outside_plan", message: "files outside the plan: pnpm-lock.yaml" } }).where(eq(nodeExecutions.runId, run_id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run_id));
  expect(await call("repair_run", { run_id, allow_paths: ["pnpm-lock.yaml"] })).toMatchObject({ node: "planner", attempt: 2 });
  const [row] = await db.select().from(runs).where(eq(runs.id, run_id));
  expect(row!.state).toMatchObject({ memory: { planner: { extraPaths: [expect.objectContaining({ path: "pnpm-lock.yaml", by: "person" })] } } });
});

test("repair_run with latest_graph moves the run to the graph's newest version first, and says when there is none", async () => {
  const { run_id } = await call("start_run", { project: "sandbox", task: "Add a CHANGELOG.md" });
  await db.update(nodeExecutions).set({ status: "failed", error: { code: "x", message: "boom" } }).where(eq(nodeExecutions.runId, run_id));
  await db.update(runs).set({ status: "failed" }).where(eq(runs.id, run_id));
  expect(await call("repair_run", { run_id, latest_graph: true })).toEqual({ error: "the run is already on version 1 of graph linear, its latest" });

  await saveGraphVersion(db, { projectId, name: "linear", document: linear });
  expect(await call("repair_run", { run_id, latest_graph: true })).toMatchObject({ node: "planner", attempt: 2, graph_version: 2 });
  const [row] = await db.select({ graphVersionId: runs.graphVersionId }).from(runs).where(eq(runs.id, run_id));
  const [upgraded] = await db.select().from(events).where(and(eq(events.runId, run_id), eq(events.type, "run.graph_upgraded")));
  expect(upgraded?.payload).toMatchObject({ from: { version: 1 }, to: { version: 2, graphVersionId: row!.graphVersionId } });
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

test("list_notifications keeps a link to GitHub as it is", async () => {
  await createNotification(db, { tone: "attention", title: "sandbox: PR #9 has 1 unresolved review thread", body: "Add usage docs", href: "https://github.com/octo/sample/pull/9" });
  expect((await call("list_notifications")).items).toEqual([expect.objectContaining({ url: "https://github.com/octo/sample/pull/9" })]);
});

test("add_project adds a repository the credential can reach, on its default branch, and refuses one twice", async () => {
  github.repos = [{ id: 7, owner: "octo", name: "widgets", fullName: "octo/widgets", defaultBranch: "trunk", private: false, description: null, pushedAt: null, archived: false }];
  expect(await call("add_project", { repo: "octo/widgets" })).toMatchObject({ name: "widgets", repo: "octo/widgets", default_branch: "trunk", url: expect.stringMatching(new RegExp(`^${BASE}/projects/`)) });
  expect((await call("list_projects")).map((p: { name: string }) => p.name)).toEqual(["sandbox", "widgets"]);
  expect(await call("add_project", { repo: "octo/widgets" })).toEqual({ error: expect.stringMatching(/already a project/) });
});

test("add_project for a repository that is already a project under its old name names the project and the move command", async () => {
  // sandbox was added as octo/sample, GitHub's repository 42, which GitHub has since moved to acme.
  await db.update(projects).set({ repoId: 42 }).where(eq(projects.id, projectId));
  github.repoId = 42;

  expect(await call("add_project", { repo: "acme/sample" })).toEqual({
    error: "acme/sample is the project sandbox, which knows it as octo/sample. It moved: run handoff project move sandbox --repo acme/sample, or use Settings, Projects, Repository moved.",
  });
  expect((await call("list_projects")).map((p: { name: string }) => p.name)).toEqual(["sandbox"]);
});

test("setup_plan with copy_from copies the old Project's items into the new plan", async () => {
  const old = await plan.createProject("octo", { owner: "octo", name: "sample" }, "sandbox plan");
  await plan.setStatus({ owner: "octo", name: "sample" }, old.number, 12, "Ready", { add: true });
  await db.update(projects).set({ repoOwner: "acme" }).where(eq(projects.id, projectId));

  const result = await call("setup_plan", { project: "sandbox", copy_from: { owner: "octo", number: old.number } });

  expect(result).toMatchObject({ created: true, copied: { from: { owner: "octo", number: old.number }, items: [12], items_with_priority: [] } });
  expect((await plan.listItems("acme", result.project.number, { owner: "acme", name: "sample" })).map((i) => [i.number, i.status])).toEqual([[12, "Ready"]]);
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

test("list_runs and get_run say a run waits on permission, at which step and since when, and keep its status running", async () => {
  const runId = await startedRun();
  const quiet = (await call("start_run", { project: "sandbox", task: "Works on its own" })).run_id as string;
  const coder = await seedExecution(db, runId, { nodeKey: "coder", status: "running", waitingOn: "permission" });
  const asked = new Date("2026-10-05T09:00:00.000Z");
  await db.insert(permissionRequests).values({ id: "3f6b2a10-0000-4000-8000-000000000006", runId, nodeExecutionId: coder.id, toolName: "Bash", input: { command: "ls" }, createdAt: asked });
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));

  const listed = Object.fromEntries((await call("list_runs", { project: "sandbox" })).map((r: { id: string }) => [r.id, r]));
  expect(listed[runId]).toMatchObject({ status: "running", waiting_on: { kind: "permission", step: "coder", since: asked.toISOString() } });
  expect(listed[quiet]).toMatchObject({ waiting_on: null });
  expect(await call("get_run", { run_id: runId })).toMatchObject({ status: "running", waiting_on: { kind: "permission", step: "coder", since: asked.toISOString() } });
  expect(await call("get_run", { run_id: quiet })).toMatchObject({ waiting_on: null });
});

test("get_run describes a Monitor prompt by its description and command, next to the full input", async () => {
  const runId = await startedRun();
  const coder = await seedExecution(db, runId, { nodeKey: "coder", status: "running", waitingOn: "permission" });
  const input = { command: "until grep -q finished /tmp/e2e.log; do sleep 5; done", timeout_ms: 600000, description: "e2e run finishing (re-arm)" };
  const id = "3f6b2a10-0000-4000-8000-000000000005";
  await db.insert(permissionRequests).values({ id, runId, nodeExecutionId: coder.id, toolName: "Monitor", input });
  const { permissions } = await call("get_run", { run_id: runId });
  expect(permissions).toEqual([
    { id, node: "coder", attempt: 1, tool: "Monitor", asks: "asks to use Monitor", detail: "e2e run finishing (re-arm)\nuntil grep -q finished /tmp/e2e.log; do sleep 5; done", input, asked_at: expect.any(String) },
  ]);
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

test("get_run on a Try it gate has the demo's warnings from the server log and the console, marked new", async () => {
  const runId = await startedRun();
  const gate = await seedExecution(db, runId, { nodeKey: "try", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const warnings = [
    { source: "server", level: "error", text: "Error: could not load tasks", new: true },
    { source: "console", level: "warning", text: "Each child in a list should have a unique key prop", new: false },
  ];
  const context = { reason: "try", acceptance: ["A user can create a task"], preview: { status: "failed", error: "no launch file" }, warnings };
  await db.insert(questions).values({ runId, nodeExecutionId: gate.id, question: "Try the app and check each acceptance criterion.", options: ["approve", "changes"], context });
  const [asked] = (await call("get_run", { run_id: runId })).questions;
  expect(asked.try.warnings).toEqual(warnings);
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

test("a code review gate lists the reviewer's findings, and answer_question sends the Fix now ones it names, or every Blocking and Should fix one", async () => {
  const runId = await startedRun();
  const comments = [
    { path: "src/a.ts", line: 2, body: "Name the constant.", severity: "should_fix" },
    { path: "src/b.ts", body: "Crashes on an empty list.", severity: "blocking" },
    { path: "docs/notes.md", body: "Link the ADR.", severity: "follow_up" },
  ];
  await seedExecution(db, runId, { nodeKey: "review", nodeType: "code_review", status: "passed", output: { verdict: "approve", comments } });
  const ask = async (attempt: number) => {
    const gate = await seedExecution(db, runId, { nodeKey: "code_gate", nodeType: "human_gate", executorKind: "human", status: "waiting", attempt });
    const review = { from: "review", kind: "code", markdown: "Verdict: approve", backTo: "coder" };
    const [question] = await db.insert(questions).values({ runId, nodeExecutionId: gate.id, question: "Review the code from review", options: ["approve", "changes", "fix"], context: { reason: "approval", review } }).returning();
    return question!;
  };
  const first = await ask(1);
  expect((await call("get_run", { run_id: runId })).questions[0].findings).toEqual([
    { index: 1, severity: "should_fix", path: "src/a.ts", line: 2, body: "Name the constant.", fix_now: true },
    { index: 2, severity: "blocking", path: "src/b.ts", body: "Crashes on an empty list.", fix_now: true },
    { index: 3, severity: "follow_up", path: "docs/notes.md", body: "Link the ADR.", fix_now: false },
  ]);
  expect(await call("answer_question", { question_id: first.id, answer: "Fix the crash.", option: "changes", findings: [2] })).toMatchObject({ answered: true });
  expect((await db.select().from(questions).where(eq(questions.id, first.id)))[0]?.comments).toEqual([{ path: "src/b.ts", body: "Crashes on an empty list.", author: "review" }]);

  const second = await ask(2);
  expect(await call("answer_question", { question_id: second.id, answer: "Fix them, then go on.", option: "fix" })).toMatchObject({ answered: true });
  expect((await db.select().from(questions).where(eq(questions.id, second.id)))[0]?.comments).toEqual([
    { path: "src/a.ts", line: 2, body: "Name the constant.", author: "review" },
    { path: "src/b.ts", body: "Crashes on an empty list.", author: "review" },
  ]);
});

test("answer_question with split accepts a planner's split: the later parts' issues open and the run narrows to the first", async () => {
  const runId = await startedRun();
  const gate = await seedExecution(db, runId, { nodeKey: "plan_gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const parts = [
    { title: "Show todos as a board", body: "A board with a column per status.", ownedPaths: ["src/board.tsx"] },
    { title: "Drag todos between columns", body: "Drag a card to change its status.", ownedPaths: ["src/drag.ts"] },
  ];
  const [question] = await db
    .insert(questions)
    .values({ runId, nodeExecutionId: gate.id, question: "Review the split from planner", options: ["split", "changes"], context: { reason: "approval", review: { from: "planner", kind: "split", markdown: "" }, split: { parts } } })
    .returning();
  expect(await call("answer_question", { question_id: question!.id, answer: "Split it.", option: "split" })).toMatchObject({ answered: true, run_id: runId });
  const opened = [...github.issues.values()].find((i) => i.title === "Drag todos between columns");
  expect(opened?.body).toContain("Drag a card to change its status.");
  const [run] = await db.select({ task: runs.task }).from(runs).where(eq(runs.id, runId));
  expect(run?.task).toBe("Show todos as a board\n\nA board with a column per status.");
  expect((await db.select().from(questions).where(eq(questions.id, question!.id)))[0]).toMatchObject({ option: "split", answeredBy: "claude-code" });
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

test("get_project returns the plan mode", async () => {
  expect(await call("get_project", { project: "sandbox" })).toMatchObject({ name: "sandbox", plan_mode: "flow" });
  await db.update(projects).set({ planMode: "timeline" }).where(eq(projects.id, projectId));
  expect(await call("get_project", { project: "sandbox" })).toMatchObject({ plan_mode: "timeline" });
});

test("get_project returns the permission timeout in minutes", async () => {
  expect(await call("get_project", { project: "sandbox" })).toMatchObject({ permission_timeout_minutes: 10 });
  await db.update(projects).set({ permissionTimeoutMinutes: 45 }).where(eq(projects.id, projectId));
  expect(await call("get_project", { project: "sandbox" })).toMatchObject({ permission_timeout_minutes: 45 });
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

test("a merge step that waits on unresolved review threads says so and names them in get_run and list_inbox", async () => {
  const runId = (await call("start_run", { project: "sandbox", task: "Add usage docs" })).run_id as string;
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, runId));
  const merge = await seedExecution(db, runId, { nodeKey: "merge", nodeType: "merge", executorKind: "github", status: "waiting", waitKind: "github_pr" });
  const thread = { path: "src/app.ts", line: 12, outdated: false, author: "coderabbitai", body: "Handle the empty list.", url: "https://github.com/octo/sample/pull/9#discussion_r1" };
  await db.transaction((tx) => appendEvents(tx, runId, [{ type: "merge.threads_unresolved", payload: { number: 9, url: "https://github.com/octo/sample/pull/9", threads: [thread] }, nodeExecutionId: merge.id }]));
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, runId));

  const steps = (await call("get_run", { run_id: runId })).steps;
  expect(steps.at(-1)).toMatchObject({ node: "merge", state: "waiting", waiting_on: "review_threads", review_threads: [thread] });
  expect(steps[0]).not.toHaveProperty("review_threads");
  expect((await call("list_inbox", { project: "sandbox" })).pull_requests).toEqual([expect.objectContaining({ run_id: runId, pr: 9, unresolved_threads: 1 })]);
});

test("a PR step that waits for a reviewer's next review after handoff answered its comments says re_review, and ci once it waits on CI alone", async () => {
  const runId = (await call("start_run", { project: "sandbox", task: "Add usage docs" })).run_id as string;
  await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.runId, runId));
  const pr = await seedExecution(db, runId, { nodeKey: "pr", nodeType: "pr", executorKind: "github", status: "waiting", waitKind: "github_pr" });
  const look = (reReview: boolean) => [
    { type: "github.pr", payload: { number: 9, ci: "success" }, nodeExecutionId: pr.id },
    ...(reReview ? [{ type: "github.re_review", payload: { number: 9, reviewers: ["coderabbitai"], items: ["R1"] }, nodeExecutionId: pr.id }] : []),
  ];
  await db.transaction((tx) => appendEvents(tx, runId, look(true)));
  await db.update(runs).set({ status: "waiting" }).where(eq(runs.id, runId));
  expect((await call("get_run", { run_id: runId })).steps.at(-1)).toMatchObject({ node: "pr", state: "waiting", waiting_on: "re_review" });

  // A later look that waits on CI only, after the reviewer reviewed again.
  await db.transaction((tx) => appendEvents(tx, runId, look(false)));
  expect((await call("get_run", { run_id: runId })).steps.at(-1)).toMatchObject({ node: "pr", state: "waiting", waiting_on: "ci" });
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

/** Plans the sandbox project in Timeline mode, as every project added before the plan mode does. */
const timeline = () => db.update(projects).set({ planMode: "timeline" }).where(eq(projects.id, projectId));

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
  await timeline();
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
  await timeline();
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
  await timeline();
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
  await timeline();
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
  await timeline();
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
  await timeline();
  const { story } = await epicAndStory();
  plan.plans.get("octo/sample")!.project.dateFields = { start: undefined, target: undefined };
  expect((await call("schedule", { project: "sandbox", items: [{ issue: story, target: "2026-10-30" }] })).error).toMatch(/has no Start or Target field, which Timeline mode reads\. Run setup_plan/);
  expect((await call("create_task", { project: "sandbox", story, title: "Dated", brief: "A brief.", start: "2026-10-06" })).error).toMatch(/setup_plan/);
  expect([...plan.itemsOf(repo).values()].some((i) => i.start || i.target)).toBe(false);

  // setup_plan adds the missing fields to the plan's Project, and schedule then works.
  await call("setup_plan", { project: "sandbox" });
  expect(await call("schedule", { project: "sandbox", items: [{ issue: story, target: "2026-10-30" }] })).toMatchObject({ scheduled: [{ issue: story }] });
});

test("create_task with start and target sets them", async () => {
  await timeline();
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
  await timeline();
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
  expect(await refused([{ issue: undated, size: "M" }])).toMatch(/has no Size field, which Timeline mode reads\. Run setup_plan/);
  expect(sizeOf(undated)).toEqual({ size: undefined, estimate: undefined });
});

test("arrange_plan returns placements and the tasks it left out, and writes nothing", async () => {
  await timeline();
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
  await timeline();
  const { number, story } = await epicAndStory();
  await plan.ensureEstimateFields("octo", number);
  const task = await call("create_task", { project: "sandbox", story, title: "Sized", brief: "A brief.", size: "M" });
  expect(task).toMatchObject({ kind: "task", status: "Shaping", size: "M" });
  expect(sizeOf(task.number)).toEqual({ size: "M", estimate: undefined });
  expect(toolSpec("create_task").summarize({ project: "sandbox", story, title: "Sized", brief: "A brief.", size: "M" })).toBe(`Create task 'Sized' under story #${story} in sandbox, size M`);

  // A Project without the fields refuses before the issue exists.
  plan.plans.get("octo/sample")!.project.estimateFields = undefined;
  const count = github.issues.size;
  expect((await call("create_task", { project: "sandbox", story, title: "Unsized", brief: "A brief.", size: "S" })).error).toMatch(/has no Size field, which Timeline mode reads\. Run setup_plan/);
  expect(github.issues.size).toBe(count);
});

/** The sentence every date path refuses with in a Flow project. */
const NO_DATES = "sandbox plans in Flow mode: tasks have an order and blockers, no dates. Use arrange_plan and set_order, or a person can switch the plan mode in Project settings.";

/** A Flow project's plan as setup_plan made it, with the Size field only, switched to Timeline mode (#587). */
async function switchedToTimeline() {
  const { project } = await call("setup_plan", { project: "sandbox" });
  const epic = await call("create_epic", { project: "sandbox", title: "Project management", goal: "See what each task is part of." });
  const story = await call("create_story", { project: "sandbox", epic: epic.number, title: "Shaping tools", acceptance: ["Every write asks first"] });
  const task = (await call("create_task", { project: "sandbox", story: story.number, title: "Sized", brief: "Sized.", size: "M" })).number as number;
  await timeline();
  return { number: project.number as number, story: story.number as number, task };
}

test("list_plan in a Timeline project names the Start, Target and Estimate fields its Project lacks", async () => {
  const { number } = await switchedToTimeline();
  const listed = await call("list_plan", { project: "sandbox" });
  expect(listed).toMatchObject({
    mode: "timeline",
    missing_fields: ["Start", "Target", "Estimate"],
    fields_note: `GitHub Project #${number} has no Start, Target or Estimate field, which Timeline mode reads. Run setup_plan to add them, or a person can press Add the fields in Settings, Projects.`,
  });

  // setup_plan in Timeline mode adds them, and list_plan then names none.
  await call("setup_plan", { project: "sandbox" });
  const after = await call("list_plan", { project: "sandbox" });
  expect(after.missing_fields).toBeUndefined();
  expect(after.fields_note).toBeUndefined();
});

test("arrange_plan in a Timeline project without Start and Target refuses and names the missing fields", async () => {
  const { number } = await switchedToTimeline();
  expect(await call("arrange_plan", { project: "sandbox" })).toEqual({
    error: `GitHub Project #${number} has no Start, Target or Estimate field, which Timeline mode reads. Run setup_plan to add them, or a person can press Add the fields in Settings, Projects.`,
  });

  // With the dates in place, a missing Estimate alone is named in the answer and the preview still comes back.
  await plan.ensureDateFields("octo", number);
  expect(await call("arrange_plan", { project: "sandbox" })).toMatchObject({
    missing_fields: ["Estimate"],
    fields_note: `GitHub Project #${number} has no Estimate field, which Timeline mode reads. Run setup_plan to add it, or a person can press Add the fields in Settings, Projects.`,
    placements: [{ title: "Sized", hours: 1 }],
  });
});

test("schedule and set_size with an estimate in a Timeline project name the fields its Project lacks and write nothing", async () => {
  const { number, task } = await switchedToTimeline();
  const writes = vi.spyOn(plan, "setManyPlanFields");
  expect(await call("schedule", { project: "sandbox", items: [{ issue: task, start: "2026-10-06", target: "2026-10-09" }] })).toEqual({
    error: `GitHub Project #${number} has no Start or Target field, which Timeline mode reads. Run setup_plan to add them, or a person can press Add the fields in Settings, Projects.`,
  });
  expect(await call("set_size", { project: "sandbox", items: [{ issue: task, estimate: "3h" }] })).toEqual({
    error: `GitHub Project #${number} has no Estimate field, which Timeline mode reads. Run setup_plan to add it, or a person can press Add the fields in Settings, Projects.`,
  });
  expect(writes).not.toHaveBeenCalled();

  // A size alone needs only the Size field the Project has.
  expect(await call("set_size", { project: "sandbox", items: [{ issue: task, size: "L" }] })).toMatchObject({ sized: [{ issue: task, size: { from: "M", to: "L" } }] });
});

/** Ready tasks of a Flow plan with the Size field, created through the tools in this order, each with its size and the titles of its blockers. */
async function flowPlan(ready: Record<string, { size?: "S" | "M" | "L"; after?: string[] }>) {
  const planned = await epicAndStory();
  await plan.ensureEstimateFields("octo", planned.number);
  const tasks: Record<string, number> = {};
  for (const [title, { size, after = [] }] of Object.entries(ready)) {
    const { number } = await call("create_task", { project: "sandbox", story: planned.story, title, brief: `${title}.`, ...(size ? { size } : {}), blocked_by: after.map((t) => tasks[t]!) });
    tasks[title] = number;
    plan.itemsOf(repo).get(number)!.status = "Ready";
  }
  return { ...planned, tasks };
}

/** The order of the Project's items on GitHub. */
const projectOrder = () => [...plan.itemsOf(repo).keys()];

test("schedule in a Flow project refuses and names arrange_plan and set_order", async () => {
  const { tasks } = await flowPlan({ First: {} });
  const before = structuredClone([...plan.itemsOf(repo).entries()]);
  const writes = vi.spyOn(plan, "setManyPlanFields");
  expect(await call("schedule", { project: "sandbox", items: [{ issue: tasks.First, start: "2026-10-06", target: "2026-10-09" }] })).toEqual({ error: NO_DATES });
  expect(writes).not.toHaveBeenCalled();
  expect([...plan.itemsOf(repo).entries()]).toEqual(before);
});

test("set_order in a Timeline project refuses", async () => {
  const { tasks } = await flowPlan({ First: {}, Second: {} });
  await timeline();
  const moves = vi.spyOn(plan, "moveItems");
  expect(await call("set_order", { project: "sandbox", order: [tasks.Second, tasks.First] })).toEqual({
    error: "sandbox plans in Timeline mode: order work with dates through arrange_plan and schedule.",
  });
  expect(moves).not.toHaveBeenCalled();
});

test("set_size in a Flow project sets a size and refuses an estimate", async () => {
  const { tasks } = await flowPlan({ First: { size: "S" }, Second: {} });
  // A Flow plan needs only the Size field, and dates left from Timeline mode stay as they are.
  plan.plans.get("octo/sample")!.project.estimateFields!.estimate = undefined;
  Object.assign(plan.itemsOf(repo).get(tasks.First!)!, { start: "2026-10-04", target: "2026-10-04" });
  expect(await call("set_size", { project: "sandbox", items: [{ issue: tasks.First, size: "L" }] })).toEqual({
    sized: [{ issue: tasks.First, title: "First", size: { from: "S", to: "L" } }],
    summary: `#${tasks.First} First: size S to L`,
  });
  expect([sizeOf(tasks.First!), datesOf(tasks.First!)]).toEqual([
    { size: "L", estimate: undefined },
    { start: "2026-10-04", target: "2026-10-04" },
  ]);

  const writes = vi.spyOn(plan, "setManyPlanFields");
  const refusal = "sandbox plans in Flow mode, which has no hours. Set a size with set_size instead: S, M or L.";
  expect(await call("set_size", { project: "sandbox", items: [{ issue: tasks.Second, size: "M" }, { issue: tasks.First, estimate: "3h" }] })).toEqual({ error: refusal });
  expect(await call("set_size", { project: "sandbox", items: [{ issue: tasks.First, estimate: null }] })).toEqual({ error: refusal });
  expect(writes).not.toHaveBeenCalled();
  expect(sizeOf(tasks.Second!)).toEqual({ size: undefined, estimate: undefined });
});

test("create_task with dates in a Flow project refuses and writes nothing", async () => {
  const { number, epic, story } = await epicAndStory();
  const count = github.issues.size;
  const refusal = { error: "sandbox plans in Flow mode, which has no dates. Leave start and target out; set_order places the task." };
  expect(await call("create_task", { project: "sandbox", story, title: "Dated", brief: "A brief.", start: "2026-10-06", target: "2026-10-09" })).toEqual(refusal);
  expect(await call("create_story", { project: "sandbox", epic, title: "Dated story", acceptance: ["x"], target: "2026-10-30" })).toEqual(refusal);
  expect(github.issues.size).toBe(count);
  // A size is still welcome: the Flow uses it to tell which lane frees first.
  await plan.ensureEstimateFields("octo", number);
  expect(await call("create_task", { project: "sandbox", story, title: "Sized", brief: "A brief.", size: "M" })).toMatchObject({ kind: "task", size: "M" });
});

test("setup_plan in a Flow project adds Size and no date or Estimate field", async () => {
  const created = await call("setup_plan", { project: "sandbox" });
  expect(created).toMatchObject({ created: true, added_date_fields: [], added_estimate_fields: ["Size"] });
  expect(created.roadmap).toBeUndefined();
  const { dateFields, estimateFields } = plan.plans.get("octo/sample")!.project;
  expect({ dateFields, estimateFields }).toEqual({
    dateFields: { start: undefined, target: undefined },
    estimateFields: { size: { id: expect.any(String), options: { S: expect.any(String), M: expect.any(String), L: expect.any(String) } }, estimate: undefined },
  });
  // Again, it finds nothing missing.
  expect(await call("setup_plan", { project: "sandbox" })).toMatchObject({ created: false, added_date_fields: [], added_estimate_fields: [] });
  expect(plan.plans.get("octo/sample")!.project.estimateFields?.estimate).toBeUndefined();
});

test("list_plan in a Flow project returns places, lanes, pins and progress and no dates or hours", async () => {
  const { story, tasks } = await flowPlan({ First: { size: "S" }, Running: {}, Third: { size: "L", after: ["First"] } });
  const later = (await call("create_task", { project: "sandbox", story, title: "Later", brief: "Later." })).number as number;
  await db.insert(projectSchedulers).values({ projectId, maxRuns: 2, graphName: "linear" });
  const { run_id } = await call("start_run", { project: "sandbox", issues: [tasks.Running] });
  await db.insert(planPins).values({ projectId, issue: tasks.Third!, pinnedBy: "person", reason: "drop" });
  Object.assign(plan.itemsOf(repo).get(tasks.First!)!, { start: "2026-10-04", target: "2026-10-04", estimate: 3 });

  const listed = await call("list_plan", { project: "sandbox" });
  expect(listed).toMatchObject({ mode: "flow", lanes: 2, held: [], queue: [tasks.First, tasks.Third, later] });
  const byNumber = Object.fromEntries((listed.epics[0].stories[0].tasks as { number: number }[]).map((t) => [t.number, t]));
  // The run takes lane 1; First takes lane 2, and Third follows it there once First ends.
  expect(byNumber[tasks.Running!]).toMatchObject({ status: "Running", place: null, lane: 1, pinned: false, progress: { done: 0, total: expect.any(Number) }, waits_on: null, run: { id: run_id } });
  expect(byNumber[tasks.First!]).toMatchObject({ place: 1, lane: 2, pinned: false, waits_for: [], after: null, skipped: null, progress: null });
  expect(byNumber[tasks.Third!]).toMatchObject({ place: 2, lane: 2, pinned: true, waits_for: [] });
  expect(byNumber[later]).toMatchObject({ status: "Shaping", place: 3, lane: 1, pinned: false });
  expect(JSON.stringify(listed)).not.toMatch(/"start"|"target"|estimate_hours|"duration"|capacity_hours|forecasts/);
});

test("arrange_plan in a Flow project returns the optimized order with its moves and kept pins, and writes nothing", async () => {
  // Small first, then the long chain of Long and After, then a pinned task at the end.
  const { tasks } = await flowPlan({ Small: { size: "S" }, Long: { size: "L" }, After: { size: "M", after: ["Long"] }, Pinned: { size: "S" } });
  await db.insert(planPins).values({ projectId, issue: tasks.Pinned!, pinnedBy: "person", reason: "drop" });
  const before = projectOrder();
  const writes = [vi.spyOn(plan, "moveItems"), vi.spyOn(plan, "setManyPlanFields"), vi.spyOn(plan, "setPlanFields")];

  expect(await call("arrange_plan", { project: "sandbox" })).toEqual({
    mode: "flow",
    was: [tasks.Small, tasks.Long, tasks.After, tasks.Pinned],
    moves: [
      { issue: tasks.Long, title: "Long", from: 2, to: 1 },
      { issue: tasks.After, title: "After", from: 3, to: 2 },
      { issue: tasks.Small, title: "Small", from: 1, to: 3 },
    ],
    kept: [{ issue: tasks.Pinned, title: "Pinned", place: 4 }],
    queue: [
      { issue: tasks.Long, title: "Long", place: 1, lane: 1 },
      { issue: tasks.After, title: "After", place: 2, lane: 1 },
      { issue: tasks.Small, title: "Small", place: 3, lane: 1 },
      { issue: tasks.Pinned, title: "Pinned", place: 4, lane: 1 },
    ],
    waits_for: [],
    summary: `#${tasks.Long} from Next 2 to Next 1; #${tasks.After} from Next 3 to Next 2; #${tasks.Small} from Next 1 to Next 3. #${tasks.Pinned} is pinned and stays Next 4.`,
  });
  // Scoped to Small and After, nothing moves: After waits for Long, which stays where it is.
  expect((await call("arrange_plan", { project: "sandbox", issues: [tasks.Small, tasks.After] })).moves).toEqual([]);
  for (const write of writes) expect(write).not.toHaveBeenCalled();
  expect(projectOrder()).toEqual(before);
  expect(await db.select({ issue: planPins.issue }).from(planPins)).toEqual([{ issue: tasks.Pinned }]);
});

test("set_order writes the order, pins what pin names, and refuses to move a pinned task unless unpin names it", async () => {
  const { tasks } = await flowPlan({ Alpha: {}, Bravo: {}, Charlie: {} });
  const { Alpha: A, Bravo: B, Charlie: C } = tasks as Record<"Alpha" | "Bravo" | "Charlie", number>;
  await db.insert(planPins).values({ projectId, issue: C, pinnedBy: "person", reason: "drop" });
  const queueOnGitHub = () => projectOrder().filter((n) => [A, B, C].includes(n));

  expect(await call("set_order", { project: "sandbox", order: [B, A] })).toMatchObject({
    moved: [
      { issue: B, from: 2, to: 1 },
      { issue: A, from: 1, to: 2 },
    ],
    pinned: [],
    unpinned: [],
  });
  expect(queueOnGitHub()).toEqual([B, A, C]);

  const moves = vi.spyOn(plan, "moveItems");
  expect(await call("set_order", { project: "sandbox", order: [C, B] })).toEqual({ error: `#${C} is pinned by a person. Arrange around it, or name it in unpin.` });
  // An order read before the last write is stale.
  expect(await call("set_order", { project: "sandbox", order: [B, A], was: [A, B, C] })).toEqual({
    error: "The order changed on GitHub since it was read. Read it again with list_plan or arrange_plan.",
  });
  expect(moves).not.toHaveBeenCalled();

  expect(await call("set_order", { project: "sandbox", order: [C, B], unpin: [C], pin: [B], was: [B, A, C] })).toMatchObject({
    moved: [
      { issue: C, from: 3, to: 1 },
      { issue: B, from: 1, to: 3 },
    ],
    pinned: [B],
    unpinned: [C],
  });
  expect(queueOnGitHub()).toEqual([C, A, B]);
  expect(await db.select({ issue: planPins.issue, pinnedBy: planPins.pinnedBy, reason: planPins.reason }).from(planPins)).toEqual([{ issue: B, pinnedBy: "claude-code", reason: "set_order" }]);
});

/** The sandbox repository's owner octo is an organization, so its Projects are the organization's. */
const organization = () => plan.owners.set("octo", "Organization");

test("list_github_projects lists the organization's Projects for an organization repository", async () => {
  organization();
  const other = await roadmap();
  const { number } = await withPlan();
  // A Project of another owner is not the repository owner's, so it is not listed.
  await plan.createProject("ann", { owner: "ann", name: "notes" }, "Notes");

  expect(await call("list_github_projects", { project: "sandbox" })).toEqual([
    { number, title: "sandbox plan", url: `https://github.com/orgs/octo/projects/${number}`, linked: true, missing_status_options: [] },
    { number: other, title: "Roadmap", url: `https://github.com/orgs/octo/projects/${other}`, linked: false, missing_status_options: ["Shaping", "Ready", "Running", "In review"] },
  ]);
});

test("arrange_plan in a Flow project reads an organization's plan", async () => {
  organization();
  const { tasks } = await flowPlan({ Small: { size: "S" }, Long: { size: "L" }, After: { size: "M", after: ["Long"] } });
  const writes = [vi.spyOn(plan, "moveItems"), vi.spyOn(plan, "setManyPlanFields"), vi.spyOn(plan, "setPlanFields")];

  expect(await call("arrange_plan", { project: "sandbox" })).toMatchObject({
    mode: "flow",
    was: [tasks.Small, tasks.Long, tasks.After],
    moves: [
      { issue: tasks.Long, title: "Long", from: 2, to: 1 },
      { issue: tasks.After, title: "After", from: 3, to: 2 },
      { issue: tasks.Small, title: "Small", from: 1, to: 3 },
    ],
  });
  expect(plan.plans.get("octo/sample")?.project.owner).toBe("Organization");
  for (const write of writes) expect(write).not.toHaveBeenCalled();
});

test("set_order moves a task in an organization's Project order", async () => {
  organization();
  const { tasks } = await flowPlan({ Alpha: {}, Bravo: {} });
  const { Alpha: A, Bravo: B } = tasks as Record<"Alpha" | "Bravo", number>;

  expect(await call("set_order", { project: "sandbox", order: [B, A], was: [A, B], pin: [B] })).toMatchObject({
    moved: [
      { issue: B, from: 2, to: 1 },
      { issue: A, from: 1, to: 2 },
    ],
    pinned: [B],
  });
  expect(projectOrder().filter((n) => [A, B].includes(n))).toEqual([B, A]);
  expect(plan.plans.get("octo/sample")?.project.owner).toBe("Organization");
});

/** The repository's milestones: 0.9 due Oct 20 and 1.0 without a due date, open, and 0.8, closed. */
function milestones() {
  github.milestones.set(1, { number: 1, title: "0.9", dueOn: "2026-10-20" });
  github.milestones.set(2, { number: 2, title: "1.0" });
  github.milestones.set(3, { number: 3, title: "0.8", state: "closed" });
}

test("list_plan returns the milestones, open and closed, with their tasks, and each item's milestone, own or inherited", async () => {
  milestones();
  const { epic, story } = await epicAndStory();
  const create = async (title: string) => (await call("create_task", { project: "sandbox", story, title, brief: `${title}.` })).number as number;
  const first = await create("First");
  const second = await create("Second");
  plan.itemsOf(repo).get(first)!.status = "Ready";
  github.issues.get(epic)!.milestone = 1;
  github.issues.get(second)!.milestone = 2;

  const listed = await call("list_plan", { project: "sandbox" });
  expect(listed.milestones).toEqual([
    { number: 1, title: "0.9", state: "open", due_on: "2026-10-20", url: "https://github.com/octo/sample/milestone/1", done: 0, total: 1, last_in_order: { issue: first, place: 1 }, skipped: [] },
    { number: 2, title: "1.0", state: "open", due_on: null, url: "https://github.com/octo/sample/milestone/2", done: 0, total: 1, last_in_order: { issue: second, place: 2 }, skipped: [] },
    { number: 3, title: "0.8", state: "closed", due_on: null, url: "https://github.com/octo/sample/milestone/3", done: 0, total: 0, last_in_order: null, skipped: [] },
  ]);
  expect(listed.no_milestone).toEqual({ done: 0, total: 0 });
  const [e] = listed.epics;
  expect(e.milestone).toEqual({ number: 1, title: "0.9", inherited_from: null });
  expect(e.stories[0].milestone).toEqual({ number: 1, title: "0.9", inherited_from: { kind: "epic", issue: epic } });
  expect(e.stories[0].tasks.map((t: { number: number; milestone: unknown }) => [t.number, t.milestone])).toEqual([
    [first, { number: 1, title: "0.9", inherited_from: { kind: "epic", issue: epic } }],
    [second, { number: 2, title: "1.0", inherited_from: null }],
  ]);
  // A Flow project gives no forecast: no end day and no late or early.
  expect(JSON.stringify(listed.milestones)).not.toMatch(/"ends"|against_due|undated/);
});

test("list_plan in a Timeline project says when each milestone ends against its due date and names its tasks without dates", async () => {
  await timeline();
  milestones();
  const { epic, story } = await epicAndStory();
  github.issues.get(epic)!.milestone = 1;
  const dated = (await call("create_task", { project: "sandbox", story, title: "Dated", brief: "Dated.", start: "2026-10-19", target: "2026-10-22" })).number as number;
  const undated = (await call("create_task", { project: "sandbox", story, title: "Undated", brief: "Undated." })).number as number;
  const early = (await call("create_task", { project: "sandbox", story, title: "Early", brief: "Early.", milestone: "1.0", target: "2026-10-01" })).number as number;
  github.milestones.get(2)!.dueOn = "2026-10-04";

  const listed = await call("list_plan", { project: "sandbox" });
  expect(listed.milestones.slice(0, 2)).toEqual([
    expect.objectContaining({ number: 2, total: 1, ends: "2026-10-01", against_due: "3 days early", undated_tasks: [] }),
    expect.objectContaining({ number: 1, total: 2, ends: "2026-10-22", against_due: "2 days late", undated_tasks: [undated] }),
  ]);
  expect(listed.milestones[2]).toMatchObject({ number: 3, ends: null, against_due: null, undated_tasks: [] });
  expect(JSON.stringify(listed.milestones)).not.toMatch(/last_in_order|skipped/);
  expect(dated).toBeGreaterThan(0);
  expect(early).toBeGreaterThan(0);
});

test("set_milestone sets a milestone by number or title on epics, stories and tasks, clears it with null, and sets an epic only", async () => {
  milestones();
  const { epic, story } = await epicAndStory();
  const task = (await call("create_task", { project: "sandbox", story, title: "Add the migration", brief: "Add it." })).number as number;

  expect(await call("set_milestone", { project: "sandbox", issues: [epic], milestone: 1 })).toEqual({
    milestone: { number: 1, title: "0.9" },
    set: [{ issue: epic, kind: "epic", title: "Project management", from: null }],
    summary: "#" + epic + " Project management: none to 0.9",
  });
  // The epic alone is written; its story and task inherit 0.9.
  expect(github.milestoneWrites).toEqual([{ number: epic, milestone: 1 }]);
  const listed = await call("list_plan", { project: "sandbox" });
  expect(listed.epics[0].stories[0].tasks[0].milestone).toEqual({ number: 1, title: "0.9", inherited_from: { kind: "epic", issue: epic } });

  expect(await call("set_milestone", { project: "sandbox", issues: [story, task], milestone: " 1.0" })).toMatchObject({
    milestone: { number: 2, title: "1.0" },
    set: [
      { issue: story, kind: "story", from: null },
      { issue: task, kind: "task", from: null },
    ],
  });
  expect(github.milestoneOf(task)).toEqual({ number: 2, title: "1.0" });
  expect(await call("set_milestone", { project: "sandbox", issues: [task], milestone: null })).toEqual({
    milestone: null,
    set: [{ issue: task, kind: "task", title: "Add the migration", from: { number: 2, title: "1.0" } }],
    summary: `#${task} Add the migration: 1.0 to none`,
  });
  expect(github.milestoneOf(task)).toBeUndefined();
});

test("set_milestone refuses a closed or unknown milestone, an issue outside the plan and a repeated issue, and writes nothing", async () => {
  milestones();
  const { epic } = await epicAndStory();
  const refusal = async (args: Record<string, unknown>) => (await call("set_milestone", { project: "sandbox", issues: [epic], ...args })).error as string;
  expect(await refusal({ milestone: 3 })).toBe("Milestone 0.8 (#3) of octo/sample is closed. Reopen it on GitHub, or pick an open milestone: 0.9 (#1, due 2026-10-20), 1.0 (#2).");
  expect(await refusal({ milestone: "2.0" })).toBe('octo/sample has no milestone "2.0". Its open milestones: 0.9 (#1, due 2026-10-20), 1.0 (#2).');
  expect(await refusal({ milestone: 1, issues: [11] })).toBe("#11 is not in the plan of sandbox. Add it with plan_issue first.");
  expect(await refusal({ milestone: 1, issues: [epic, epic] })).toBe(`#${epic} appears twice. Give each issue once.`);
  expect(github.milestoneWrites).toEqual([]);
  expect(toolSpec("set_milestone").input.safeParse({ project: "sandbox", issues: [epic] }).success).toBe(false);
});

test("create_epic, create_story and create_task take a milestone by number or title and refuse a closed or unknown one before creating anything", async () => {
  milestones();
  await withPlan();
  const epic = await call("create_epic", { project: "sandbox", title: "Project management", goal: "A plan.", milestone: "0.9" });
  expect(epic).toMatchObject({ kind: "epic", milestone: { number: 1, title: "0.9" } });
  expect(github.milestoneOf(epic.number)).toEqual({ number: 1, title: "0.9" });
  const story = await call("create_story", { project: "sandbox", epic: epic.number, title: "Shaping tools", acceptance: ["x"], milestone: 2 });
  expect(story).toMatchObject({ kind: "story", milestone: { number: 2, title: "1.0" } });
  const task = await call("create_task", { project: "sandbox", story: story.number, title: "Add the migration", brief: "Add it.", milestone: 1 });
  expect(github.milestoneOf(task.number)).toEqual({ number: 1, title: "0.9" });
  // Without one, the issue has none of its own and inherits its story's.
  const plain = await call("create_task", { project: "sandbox", story: story.number, title: "Plain", brief: "Plain." });
  expect(plain.milestone).toBeUndefined();
  expect(github.milestoneOf(plain.number)).toBeUndefined();

  const count = github.issues.size;
  expect((await call("create_epic", { project: "sandbox", title: "Old", goal: "Old.", milestone: "0.8" })).error).toMatch(/^Milestone 0\.8 \(#3\) of octo\/sample is closed\./);
  expect((await call("create_story", { project: "sandbox", epic: epic.number, title: "Lost", acceptance: ["x"], milestone: 9 })).error).toMatch(/^octo\/sample has no milestone #9\./);
  expect((await call("create_task", { project: "sandbox", story: story.number, title: "Lost", brief: "Lost.", milestone: "nope" })).error).toMatch(/^octo\/sample has no milestone "nope"\./);
  expect(github.issues.size).toBe(count);
});

test("set_milestone and create_task with a milestone work on an organization's plan", async () => {
  organization();
  milestones();
  const { story } = await epicAndStory();
  const task = await call("create_task", { project: "sandbox", story, title: "Org task", brief: "Org.", milestone: "1.0" });
  expect(github.milestoneOf(task.number)).toEqual({ number: 2, title: "1.0" });
  expect(await call("set_milestone", { project: "sandbox", issues: [task.number], milestone: 1 })).toMatchObject({ milestone: { number: 1, title: "0.9" } });
  expect(github.milestoneOf(task.number)).toEqual({ number: 1, title: "0.9" });
  expect(plan.plans.get("octo/sample")?.project.owner).toBe("Organization");
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
    ["set_order", { order: [3] }],
    ["set_milestone", { issues: [3], milestone: 1 }],
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

test("get_scheduler says which Priority orders the tasks", async () => {
  await withPlan();
  await call("start_scheduler", { project: "sandbox" });
  // In Project order no Priority is read.
  expect(await call("get_scheduler", { project: "sandbox" })).not.toHaveProperty("priority");

  // The repository's owner is an organization with the Priority issue field, and the Project has no Priority field.
  plan.owners.set("octo", "Organization");
  plan.priorityIssueFields.set("octo", ["Urgent", "High", "Medium", "Low"]);
  await call("start_scheduler", { project: "sandbox", order: "priority" });
  expect(await call("get_scheduler", { project: "sandbox" })).toMatchObject({ priority: "Priority order from the organization's Priority issue field" });

  // A Priority field of the Project's own wins.
  sandboxProject().priorityOptions = ["P0", "P1"];
  expect(await call("get_scheduler", { project: "sandbox" })).toMatchObject({ priority: "Priority order from the Project's Priority field" });
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

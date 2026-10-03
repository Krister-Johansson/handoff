import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { ClaudeChatRunner } from "@handoff/cli-adapter";
import { fakeClaude, fakeClaudeBin, lines, type FakeScenario } from "@handoff/cli-adapter/testing";
import { assistantConversations, eq, runs } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { FakeGitHub } from "@handoff/github/testing";
import { createProject, saveGraphVersion, startRunFromGraph } from "../graphs";
import { conversationMessages, createConversation, lastAssistantModel } from "./conversations";
import { assistantConfig } from "./env";
import type { TurnEvent } from "./relay";
import { findTurn } from "./relay";
import { startTurn, stopTurn, type TurnDeps } from "./turn";
import { handleTurnMcpRequest } from "./turn-mcp";

const db = createTestDb();
const github = new FakeGitHub();
let server: Server;
let baseUrl = "";
let approvalTimeoutMs = 10_000;
let uiTimeoutMs = 10_000;

// The dashboard's /api/assistant/mcp route, served for the fake CLI to call.
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));
    const request = new Request(`${baseUrl}${req.url}`, { method: req.method!, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
    const response = await handleTurnMcpRequest(request, { db, github, baseUrl, approvalTimeoutMs, uiTimeoutMs });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.$client.end();
});
beforeEach(async () => {
  await truncateAll(db);
  approvalTimeoutMs = 10_000;
  uiTimeoutMs = 10_000;
});

function deps(scenario: FakeScenario): TurnDeps & { home: string; fake: ReturnType<typeof fakeClaude> } {
  const fake = fakeClaude(scenario);
  const home = mkdtempSync(join(tmpdir(), "assistant-home-"));
  const config = { ...assistantConfig({ HANDOFF_HOME: home, CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-test" }), approvalTimeoutMs };
  const runner = new ClaudeChatRunner({
    command: { file: process.execPath, prefixArgs: [fakeClaudeBin] },
    oauthToken: "sk-ant-oat01-test",
    configDir: join(home, "claude-config"),
    baseEnv: { ...process.env, ...fake.env },
    passthroughEnv: ["FAKE_CLAUDE_SCENARIO", "FAKE_CLAUDE_RECORD"],
    killGraceMs: 200,
    trackIntervalMs: 50,
  });
  return { db, github, runner, config, baseUrl, home, fake };
}

const delta = (text: string) => ({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });

async function sandboxRun() {
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  await saveGraphVersion(db, { projectId: project.id, name: "linear", document: linear });
  return startRunFromGraph(db, { projectId: project.id, graphName: "linear", task: "Add a CHANGELOG.md" });
}

/** Collects a turn's events, answering each approval card with `answer`. */
function watch(turn: { subscribe: (l: (e: TurnEvent) => void) => () => void; answer: (id: string, a: { approved: boolean; note?: string }) => boolean }, answer?: (e: Extract<TurnEvent, { type: "confirm" }>) => { approved: boolean; note?: string } | undefined) {
  const events: TurnEvent[] = [];
  turn.subscribe((e) => {
    events.push(e);
    if (e.type === "confirm" && answer) {
      const a = answer(e);
      if (a) setTimeout(() => turn.answer(e.requestId, a), 20);
    }
  });
  return events;
}

test("a turn stores the person's message, streams the reply and stores it with the CLI session id and cost", async () => {
  const d = deps({ lines: [lines.init(), delta("Nothing "), delta("needs you."), lines.result({ result: "Nothing needs you.", total_cost_usd: 0.004 })] });
  const conversation = await createConversation(db, "What needs me?");
  const turn = await startTurn(d, conversation.id, { text: "What needs me?", source: "typed" });
  const events = watch(turn);
  await turn.done;
  expect(events.map((e) => e.type)).toEqual(["text", "text", "done"]);
  expect(events.at(-1)).toEqual({ type: "done", text: "Nothing needs you.", costUsd: 0.004 });
  const messages = await conversationMessages(db, conversation.id);
  expect(messages.map((m) => [m.role, m.content])).toEqual([
    ["user", { text: "What needs me?", source: "typed" }],
    ["assistant", { text: "Nothing needs you.", calls: [], outcome: "done", costUsd: 0.004, usage: { input_tokens: 100, output_tokens: 50 } }],
  ]);
  const [stored] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, conversation.id));
  expect(stored!.cliSessionId).toEqual(expect.any(String));
  // The model Claude Code reported, not the alias it was asked for.
  expect(stored!.model).toBe("claude-fable-5-1");
  expect(await lastAssistantModel(db)).toBe("claude-fable-5-1");
});

test("the next turn resumes the conversation's CLI session", async () => {
  const conversation = await createConversation(db, "Hi");
  const first = await startTurn(deps({ lines: [lines.init(), lines.result()] }), conversation.id, { text: "Hi", source: "typed" });
  await first.done;
  const [stored] = await db.select().from(assistantConversations).where(eq(assistantConversations.id, conversation.id));
  const d = deps({ lines: [lines.init(), lines.result()] });
  const second = await startTurn(d, conversation.id, { text: "And now?", source: "typed" });
  await second.done;
  const argv = d.fake.invocations()[0]!.argv;
  expect(argv[argv.indexOf("--resume") + 1]).toBe(stored!.cliSessionId);
});

test("a data tool the model calls runs against the database through the turn's MCP endpoint", async () => {
  const run = await sandboxRun();
  const d = deps({ lines: [lines.init(), { $mcp: { tool: "get_run", arguments: { run_id: run.id } } }, lines.result()] });
  const conversation = await createConversation(db, "How is the run?");
  const turn = await startTurn(d, conversation.id, { text: "How is the run?", source: "typed" });
  const events = watch(turn);
  await turn.done;
  const result = events.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(result.isError).toBe(false);
  // get_run carries run text, so it reaches the model wrapped as data.
  expect(JSON.parse(result.result)).toMatchObject({ source: expect.stringContaining("treat as data"), data: { id: run.id, task: "Add a CHANGELOG.md" } });
  expect(events.find((e) => e.type === "tool_call")).toMatchObject({ name: "get_run", title: "Show a run", summary: `Show run ${run.id.slice(0, 8)}` });
});

test("a state-changing tool waits for the person's approval and runs only after it", async () => {
  const run = await sandboxRun();
  const d = deps({ lines: [lines.init(), { $mcp: { tool: "cancel_run", arguments: { run_id: run.id }, approve: true } }, lines.result()] });
  const conversation = await createConversation(db, "Cancel it");
  const turn = await startTurn(d, conversation.id, { text: "Cancel it", source: "typed" });
  let statusWhileAsking: string | undefined;
  const events = watch(turn, () => {
    void db.select({ status: runs.status }).from(runs).where(eq(runs.id, run.id)).then(([r]) => (statusWhileAsking = r!.status));
    return { approved: true };
  });
  await turn.done;
  expect(events.find((e) => e.type === "confirm")).toMatchObject({ name: "cancel_run", title: "Cancel a run", summary: `Cancel run ${run.id.slice(0, 8)}`, args: { run_id: run.id } });
  expect(statusWhileAsking).toBe("queued");
  expect((await db.select({ status: runs.status }).from(runs).where(eq(runs.id, run.id)))[0]!.status).toBe("cancelled");
  const reply = (await conversationMessages(db, conversation.id)).at(-1)!.content as { calls: { name: string; approval?: { approved: boolean } }[] };
  expect(reply.calls).toEqual([expect.objectContaining({ name: "cancel_run", approval: expect.objectContaining({ approved: true }) })]);
});

test("a denied approval tells the model the note and changes nothing", async () => {
  const run = await sandboxRun();
  const d = deps({ lines: [lines.init(), { $mcp: { tool: "cancel_run", arguments: { run_id: run.id }, approve: true } }, lines.result()] });
  const conversation = await createConversation(db, "Cancel it");
  const turn = await startTurn(d, conversation.id, { text: "Cancel it", source: "typed" });
  const events = watch(turn, () => ({ approved: false, note: "Let it finish." }));
  await turn.done;
  const result = events.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(result).toMatchObject({ isError: true, result: expect.stringContaining("Let it finish.") });
  expect((await db.select({ status: runs.status }).from(runs).where(eq(runs.id, run.id)))[0]!.status).toBe("queued");
});

test("an approval nobody answers in time is denied", async () => {
  approvalTimeoutMs = 300;
  const run = await sandboxRun();
  const d = deps({ lines: [lines.init(), { $mcp: { tool: "cancel_run", arguments: { run_id: run.id }, approve: true } }, lines.result()] });
  const conversation = await createConversation(db, "Cancel it");
  const turn = await startTurn(d, conversation.id, { text: "Cancel it", source: "typed" });
  const events = watch(turn);
  await turn.done;
  expect(events.find((e) => e.type === "tool_result")).toMatchObject({ isError: true, result: expect.stringContaining("No one approved this in time") });
  expect((await db.select({ status: runs.status }).from(runs).where(eq(runs.id, run.id)))[0]!.status).toBe("queued");
});

test("a UI tool the model calls is sent to the browser and its answer returned to the model, and an unanswered one errors after the timeout", async () => {
  uiTimeoutMs = 300;
  const d = deps({
    lines: [lines.init(), { $mcp: { tool: "go_to_inbox", arguments: { project_id: "p1" } } }, { $mcp: { tool: "where_am_i", arguments: {} } }, lines.result()],
  });
  const conversation = await createConversation(db, "Open the inbox");
  const turn = await startTurn(d, conversation.id, { text: "Open the inbox", source: "typed" });
  const events: TurnEvent[] = [];
  turn.subscribe((e) => {
    events.push(e);
    if (e.type === "ui_call" && e.name === "go_to_inbox") setTimeout(() => turn.answerUi(e.requestId, { text: "Opened Inbox (/inbox?project=p1).", isError: false }), 20);
  });
  await turn.done;
  expect(events.filter((e) => e.type === "ui_call")).toEqual([
    { type: "ui_call", requestId: expect.any(String), name: "go_to_inbox", args: { project_id: "p1" } },
    { type: "ui_call", requestId: expect.any(String), name: "where_am_i", args: {} },
  ]);
  const results = events.filter((e) => e.type === "tool_result");
  expect(results[0]).toMatchObject({ isError: false, result: "Opened Inbox (/inbox?project=p1)." });
  expect(results[1]).toMatchObject({ isError: true, result: expect.stringContaining("The page did not answer") });
  expect(events.find((e) => e.type === "tool_call")).toMatchObject({ name: "go_to_inbox", title: "Open the Inbox" });
  // UI tools run without an approval card.
  const argv = d.fake.invocations()[0]!.argv;
  expect(argv[argv.indexOf("--allowedTools") + 1]).toContain("mcp__handoff__go_to_inbox");
});

const runPage = { kind: "run" as const, path: "/projects/p1/runs/r1", heading: "Add a CHANGELOG.md", tools: ["page_show_view", "page_open_step"] };
const tryPage = { kind: "try" as const, path: "/projects/p1/runs/r1/try/q1", heading: "Try it", tools: ["page_mark_criterion", "page_submit", "page_restart_app"] };

test("a page tool the model calls is sent to the browser as a ui_call and its answer returned", async () => {
  const d = deps({ lines: [lines.init(), { $mcp: { tool: "page_show_view", arguments: { view: "graph" } } }, lines.result()] });
  const conversation = await createConversation(db, "Open graph view");
  const turn = await startTurn(d, conversation.id, { text: "Open graph view", source: "typed", page: runPage });
  const events: TurnEvent[] = [];
  turn.subscribe((e) => {
    events.push(e);
    if (e.type === "ui_call") setTimeout(() => turn.answerUi(e.requestId, { text: "Showing the graph view.", isError: false }), 20);
  });
  await turn.done;
  expect(events.filter((e) => e.type === "ui_call")).toEqual([{ type: "ui_call", requestId: expect.any(String), name: "page_show_view", args: { view: "graph" } }]);
  expect(events.find((e) => e.type === "tool_call")).toMatchObject({ name: "page_show_view", title: "Show a view", summary: "Show the graph view" });
  expect(events.find((e) => e.type === "tool_result")).toMatchObject({ isError: false, result: "Showing the graph view." });
  // The model was told which page it is on, in the person's message.
  const argv = d.fake.invocations()[0]!.argv;
  expect(argv[argv.indexOf("-p") + 1]).toBe(
    '<page path="/projects/p1/runs/r1" kind="run" heading="Add a CHANGELOG.md">\nTools of this page: page_show_view, page_open_step. Call where_am_i for its state.\n</page>\nOpen graph view',
  );
});

test("a confirm page tool waits for the person's approval and runs only after it", async () => {
  const step = { $mcp: { tool: "page_submit", arguments: { option: "approve" }, approve: true } };
  const d = deps({ lines: [lines.init(), step, step, lines.result()] });
  const conversation = await createConversation(db, "Approve it");
  const turn = await startTurn(d, conversation.id, { text: "Approve it", source: "typed", page: tryPage });
  const events: TurnEvent[] = [];
  let cards = 0;
  turn.subscribe((e) => {
    events.push(e);
    // The person approves the first card and denies the second.
    if (e.type === "confirm") {
      const approved = ++cards === 1;
      setTimeout(() => turn.answer(e.requestId, approved ? { approved } : { approved, note: "Not yet." }), 20);
    }
    if (e.type === "ui_call") setTimeout(() => turn.answerUi(e.requestId, { text: "Approved. The run goes on.", isError: false }), 20);
  });
  await turn.done;
  expect(events.find((e) => e.type === "confirm")).toMatchObject({ name: "page_submit", title: "Submit Try it", summary: "Approve the app", args: { option: "approve" } });
  // The page runs the tool once, after the approval, and never after the denial.
  expect(events.map((e) => e.type).filter((t) => ["confirm", "confirmed", "ui_call"].includes(t))).toEqual(["confirm", "confirmed", "ui_call", "confirm", "confirmed"]);
  const results = events.filter((e) => e.type === "tool_result");
  expect(results[0]).toMatchObject({ isError: false, result: "Approved. The run goes on." });
  expect(results[1]).toMatchObject({ isError: true, result: expect.stringContaining("Not yet.") });
});

test("the page's non-confirm tools are in --allowedTools and its confirm tools are not", async () => {
  const d = deps({ lines: [lines.init(), lines.result()] });
  const conversation = await createConversation(db, "Hi");
  const turn = await startTurn(d, conversation.id, { text: "Hi", source: "typed", page: tryPage });
  await turn.done;
  const argv = d.fake.invocations()[0]!.argv;
  const allowed = argv[argv.indexOf("--allowedTools") + 1]!.split(",");
  expect(allowed).toEqual(expect.arrayContaining(["mcp__handoff__list_runs", "mcp__handoff__where_am_i", "mcp__handoff__page_mark_criterion"]));
  expect(allowed).not.toContain("mcp__handoff__page_submit");
  expect(allowed).not.toContain("mcp__handoff__page_restart_app");
  // Tools the page did not bind are not allowed either.
  expect(allowed).not.toContain("mcp__handoff__page_go_to_criterion");
  expect(allowed.filter((t) => t.includes("page_"))).toEqual(["mcp__handoff__page_mark_criterion"]);
});

test("the person's message is stored with the page it was asked on", async () => {
  const conversation = await createConversation(db, "Open graph view");
  const onPage = await startTurn(deps({ lines: [lines.init(), lines.result()] }), conversation.id, { text: "Open graph view", source: "voice", page: runPage });
  await onPage.done;
  const elsewhere = await startTurn(deps({ lines: [lines.init(), lines.result()] }), conversation.id, { text: "What failed?", source: "typed" });
  await elsewhere.done;
  const asked = (await conversationMessages(db, conversation.id)).filter((m) => m.role === "user").map((m) => m.content);
  // The stored message is the person's own text; the page is kept as its kind and path only.
  expect(asked).toEqual([
    { text: "Open graph view", source: "voice", page: { kind: "run", path: "/projects/p1/runs/r1" } },
    { text: "What failed?", source: "typed" },
  ]);
});

test("a chat without a project takes the project of the first page a turn names, and keeps it", async () => {
  const run = await sandboxRun();
  const other = await createProject(db, { name: "other", repo: "octo/other", defaultBranch: "main" });
  const conversation = await createConversation(db, "What failed?");
  const elsewhere = await startTurn(deps({ lines: [lines.init(), lines.result()] }), conversation.id, { text: "What failed?", source: "typed" });
  await elsewhere.done;
  expect((await db.select().from(assistantConversations).where(eq(assistantConversations.id, conversation.id)))[0]!.projectId).toBeNull();
  const onRun = await startTurn(deps({ lines: [lines.init(), lines.result()] }), conversation.id, { text: "Open graph view", source: "typed", page: { ...runPage, path: `/runs/${run.id}` } });
  await onRun.done;
  const onOther = await startTurn(deps({ lines: [lines.init(), lines.result()] }), conversation.id, { text: "And here?", source: "typed", page: { ...runPage, path: `/projects/${other.id}/runs/${run.id}` } });
  await onOther.done;
  expect((await db.select().from(assistantConversations).where(eq(assistantConversations.id, conversation.id)))[0]!.projectId).toBe(run.projectId);
});

test("in a chat on a project, the turn names the project and a call that leaves project out uses it, with no list_projects detour", async () => {
  await createProject(db, { name: "demo", repo: "octo/demo", defaultBranch: "main" });
  await createProject(db, { name: "sandbox", repo: "octo/sandbox", defaultBranch: "main" });
  const todo = await createProject(db, { name: "todooverkill", repo: "octo/todooverkill", defaultBranch: "main" });
  const conversation = await createConversation(db, "what is the status for task #151?", { path: `/projects/${todo.id}/plan` });
  const d = deps({ lines: [lines.init(), { $mcp: { tool: "get_project", arguments: {} } }, lines.result()] });
  const turn = await startTurn(d, conversation.id, { text: "what is the status for task #151?", source: "typed" });
  const events = watch(turn);
  await turn.done;
  // The model reads which project the chat is on in the person's message.
  const argv = d.fake.invocations()[0]!.argv;
  const prompt = argv[argv.indexOf("-p") + 1]!;
  expect(prompt).toMatch(/^<project name="todooverkill">\nThis chat is on project todooverkill\./);
  expect(prompt.endsWith("</project>\nwhat is the status for task #151?")).toBe(true);
  // A call without project answers for the chat's project, and its card says so.
  expect(events.find((e) => e.type === "tool_call")).toMatchObject({ name: "get_project", summary: "Show project todooverkill" });
  const result = events.find((e) => e.type === "tool_result") as Extract<TurnEvent, { type: "tool_result" }>;
  expect(result.isError).toBe(false);
  expect(JSON.parse(result.result)).toMatchObject({ name: "todooverkill", repo: "octo/todooverkill" });
});

test("in a chat without a project, a call that leaves project out is refused as before", async () => {
  await createProject(db, { name: "todooverkill", repo: "octo/todooverkill", defaultBranch: "main" });
  const conversation = await createConversation(db, "what is the status for task #151?");
  const d = deps({ lines: [lines.init(), { $mcp: { tool: "get_project", arguments: {} } }, lines.result()] });
  const turn = await startTurn(d, conversation.id, { text: "what is the status for task #151?", source: "typed" });
  const events = watch(turn);
  await turn.done;
  const argv = d.fake.invocations()[0]!.argv;
  expect(argv[argv.indexOf("-p") + 1]).toBe("what is the status for task #151?");
  expect(events.find((e) => e.type === "tool_result")).toMatchObject({ isError: true });
});

test("stopping a turn denies its open approvals and stores the turn as interrupted", async () => {
  const run = await sandboxRun();
  const d = deps({ lines: [lines.init(), delta("On it. "), { $mcp: { tool: "cancel_run", arguments: { run_id: run.id }, approve: true } }], hangAfterLine: 3 });
  const conversation = await createConversation(db, "Cancel it");
  const turn = await startTurn(d, conversation.id, { text: "Cancel it", source: "typed" });
  const events = watch(turn, () => {
    setTimeout(() => stopTurn(turn), 20);
    return undefined;
  });
  await turn.done;
  expect(events.find((e) => e.type === "confirmed")).toMatchObject({ approved: false, note: "The person stopped the turn." });
  expect(events.at(-1)).toMatchObject({ type: "interrupted" });
  expect((await conversationMessages(db, conversation.id)).at(-1)!.content).toMatchObject({ outcome: "interrupted" });
  expect((await db.select({ status: runs.status }).from(runs).where(eq(runs.id, run.id)))[0]!.status).toBe("queued");
});

test("the staging directory and the turn token are gone when the turn ends", async () => {
  const d = deps({ lines: [lines.init(), lines.result()] });
  const conversation = await createConversation(db, "Hi");
  const turn = await startTurn(d, conversation.id, { text: "Hi", source: "typed" });
  await turn.done;
  expect(existsSync(join(d.config.home, "turns", turn.id))).toBe(false);
  expect(readdirSync(join(d.config.home, "turns"))).toEqual([]);
  expect(findTurn(turn.id)).toBeUndefined();
  const late = await handleTurnMcpRequest(new Request(`${baseUrl}/api/assistant/mcp`, { method: "POST", headers: { authorization: `Bearer ${turn.token}` }, body: "{}" }), {
    db,
    github,
    baseUrl,
    approvalTimeoutMs,
    uiTimeoutMs,
  });
  expect(late.status).toBe(401);
});

test("a second turn on a running conversation is refused", async () => {
  const d = deps({ lines: [lines.init()], hangAfterLine: 1 });
  const conversation = await createConversation(db, "Hi");
  const turn = await startTurn(d, conversation.id, { text: "Hi", source: "typed" });
  await expect(startTurn(d, conversation.id, { text: "Again", source: "typed" })).rejects.toThrow(/already answering/);
  stopTurn(turn);
  await turn.done;
});

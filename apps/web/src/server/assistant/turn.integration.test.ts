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
import { conversationMessages, createConversation } from "./conversations";
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

// The dashboard's /api/assistant/mcp route, served for the fake CLI to call.
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers(Object.entries(req.headers).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])));
    const request = new Request(`${baseUrl}${req.url}`, { method: req.method!, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) });
    const response = await handleTurnMcpRequest(request, { db, github, baseUrl, approvalTimeoutMs });
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

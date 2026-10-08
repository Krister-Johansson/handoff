import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import type { CliRunOptions, CliRunRequest, CliRunResult } from "@handoff/cli-adapter";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { and, eq, events, inArray, nodeExecutions, notifications, permissionRequests, projects, type Caps } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cliNodeExecutor } from "../executors/cli-node.ts";
import { decidePermission, repairNodeExecution } from "../operations.ts";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { outputs, scripted } from "../testing/scripted.ts";
import { PERMISSION_TOOL, runAllowRules } from "./broker.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

type McpConfig = { mcpServers: Record<string, { command: string; args: string[] }> };
const ID = "3f6b2a10-0000-4000-8000-000000000001";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(read: () => T | undefined | Promise<T | undefined>, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await sleep(25);
  }
}

const requestRow = () => until(async () => (await db.select().from(permissionRequests).where(eq(permissionRequests.id, ID)))[0]);

/**
 * A planner whose Claude Code asks permission for one Bash command, as the permission server does: a
 * request file in the folder its MCP config names, then it waits for the answer handoff writes back.
 * `person` plays the person; without one, the step ends while the request still waits.
 */
function asking(person?: (dir: string) => Promise<void>) {
  const seen: { tool?: string | undefined; held?: boolean; response?: unknown } = {};
  const cli = new FakeCliExecutor([
    async (request: CliRunRequest, options: CliRunOptions): Promise<CliRunResult> => {
      seen.tool = request.permissionPromptTool;
      const dir = (JSON.parse(readFileSync(request.mcpConfigPath!, "utf8")) as McpConfig).mcpServers.handoff!.args[1]!;
      writeFileSync(join(dir, `${ID}.request.json`), JSON.stringify({ id: ID, toolName: "Bash", input: { command: "git -C /w log --oneline -8" } }));
      await requestRow();
      seen.held = options.holdIdle?.() ?? false;
      if (person) {
        await person(dir);
        const response = join(dir, `${ID}.response.json`);
        seen.response = await until(() => (existsSync(response) ? JSON.parse(readFileSync(response, "utf8")) : undefined));
      }
      await options.onSessionId?.(request.session.id);
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: outputs.planner, validated: outputs.planner };
    },
  ]);
  return { cli, seen };
}

async function runPlanner(cli: FakeCliExecutor, caps?: Partial<Caps>) {
  const { run } = await startRun(db, linear);
  const planner = cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000, permissions: { db, ...(caps ? { caps } : {}) } });
  await drain(engineDeps(db, { planner, coder: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }) }));
  return run;
}

test("a tool call the rules do not cover waits for a person, who is told, and their answer goes back to Claude Code", async () => {
  const { cli, seen } = asking(() => decidePermission(db, ID, { allow: true, decidedBy: "krister" }).then(() => {}));
  const run = await runPlanner(cli);
  expect(seen).toEqual({ tool: PERMISSION_TOOL, held: true, response: { behavior: "allow" } });
  const [row] = await db.select().from(permissionRequests).where(eq(permissionRequests.runId, run.id));
  expect(row).toMatchObject({ toolName: "Bash", input: { command: "git -C /w log --oneline -8" }, status: "allowed", decidedBy: "krister" });
  const { events, executions } = await inspect(db, run.id);
  expect(executions.find((e) => e.nodeKey === "planner")!.status).toBe("passed");
  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId));
  expect(events.map((e) => e.type)).not.toContain("notify");
  expect(await db.select().from(notifications).where(eq(notifications.runId, run.id))).toMatchObject([
    { tone: "attention", title: `${project!.name}: planner asks to run a command`, body: "git -C /w log --oneline -8", href: `/projects/${project!.id}/runs/${run.id}`, projectId: project!.id },
  ]);
});

test("a denial goes back with the person's message, and an answered request cannot be answered again", async () => {
  const { cli, seen } = asking(() => decidePermission(db, ID, { allow: false, decidedBy: "krister", message: "Read the file instead." }).then(() => {}));
  await runPlanner(cli);
  expect(seen.response).toEqual({ behavior: "deny", message: "Read the file instead." });
  await expect(decidePermission(db, ID, { allow: true, decidedBy: "late" })).rejects.toThrow(/already/);
});

test("a step gives up the Claude slot while its prompt waits, and takes it back before Claude Code gets the answer", async () => {
  let other: string | undefined;
  const { cli, seen } = asking(async (dir) => {
    const [asker] = await db.select().from(nodeExecutions).where(eq(nodeExecutions.nodeKey, "planner"));
    expect(asker?.waitingOn).toBe("permission");
    // Another Claude step takes the slot meanwhile.
    const [row] = await db.insert(nodeExecutions).values({ runId: asker!.runId, nodeKey: "other", nodeType: "coder", executorKind: "cli", attempt: 1, status: "running" }).returning();
    other = row!.id;
    await decidePermission(db, ID, { allow: true, decidedBy: "krister" });
    await sleep(600);
    expect(existsSync(join(dir, `${ID}.response.json`))).toBe(false);
    await db.update(nodeExecutions).set({ status: "passed" }).where(eq(nodeExecutions.id, other));
  });
  const run = await runPlanner(cli, { cli: 1 });
  expect(seen.response).toEqual({ behavior: "allow" });
  const planner = (await inspect(db, run.id)).executions.find((e) => e.nodeKey === "planner")!;
  expect(planner).toMatchObject({ status: "passed", waitingOn: null });
});

/** A planner that records how long its permission server waits for a person, then finishes. */
function timeoutRecorder() {
  const waits: string[] = [];
  const cli = new FakeCliExecutor([
    async (request: CliRunRequest, options: CliRunOptions): Promise<CliRunResult> => {
      waits.push((JSON.parse(readFileSync(request.mcpConfigPath!, "utf8")) as McpConfig).mcpServers.handoff!.args[2]!);
      await options.onSessionId?.(request.session.id);
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: outputs.planner, validated: outputs.planner };
    },
  ]);
  return { cli, waits };
}

test("a step's permission server waits 10 minutes for a person in a project that keeps the default", async () => {
  const { cli, waits } = timeoutRecorder();
  await runPlanner(cli);
  expect(waits).toEqual(["600000"]);
});

test("a step's permission server waits as long as its project's permission timeout says", async () => {
  const { cli, waits } = timeoutRecorder();
  const { project } = await startRun(db, linear);
  await db.update(projects).set({ permissionTimeoutMinutes: 3 }).where(eq(projects.id, project.id));
  await drain(engineDeps(db, { planner: cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000, permissions: { db } }), coder: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }) }));
  expect(waits).toEqual(["180000"]);
});

test("a project's permission timeout is a whole number of minutes from 1 to 120", async () => {
  const { project } = await startRun(db, linear);
  for (const minutes of [0, 121]) {
    await expect(db.update(projects).set({ permissionTimeoutMinutes: minutes }).where(eq(projects.id, project.id))).rejects.toThrow();
  }
  await db.update(projects).set({ permissionTimeoutMinutes: 120 }).where(eq(projects.id, project.id));
  const [row] = await db.select({ minutes: projects.permissionTimeoutMinutes }).from(projects).where(eq(projects.id, project.id));
  expect(row!.minutes).toBe(120);
});

test("a request nobody answered expires when the step ends", async () => {
  const { cli } = asking();
  const run = await runPlanner(cli);
  const [row] = await db.select().from(permissionRequests).where(eq(permissionRequests.runId, run.id));
  expect(row!.status).toBe("expired");
  await expect(decidePermission(db, ID, { allow: true, decidedBy: "late" })).rejects.toThrow(/already/);
});

const MONITOR = { command: "until grep -q finished /tmp/e2e.log; do sleep 5; done", timeout_ms: 600000, description: "e2e run finishing (re-arm)" };

/**
 * A planner whose Claude Code asks permission for each call in turn, the next once the last was
 * answered, and records the answers. `person` answers a request when it waits for one.
 */
function askingEach(calls: { id: string; toolName: string; input: Record<string, unknown> }[], person: (id: string) => Promise<void>, result: Partial<CliRunResult> = {}) {
  const answers: Record<string, unknown> = {};
  const cli = new FakeCliExecutor([
    async (request: CliRunRequest, options: CliRunOptions): Promise<CliRunResult> => {
      const dir = (JSON.parse(readFileSync(request.mcpConfigPath!, "utf8")) as McpConfig).mcpServers.handoff!.args[1]!;
      for (const call of calls) {
        writeFileSync(join(dir, `${call.id}.request.json`), JSON.stringify(call));
        const row = await until(async () => (await db.select().from(permissionRequests).where(eq(permissionRequests.id, call.id)))[0]);
        if (row.status === "pending") await person(call.id);
        const response = join(dir, `${call.id}.response.json`);
        answers[call.id] = await until(() => (existsSync(response) ? JSON.parse(readFileSync(response, "utf8")) : undefined));
      }
      await options.onSessionId?.(request.session.id);
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: outputs.planner, validated: outputs.planner, ...result };
    },
  ]);
  return { cli, answers };
}

test("a Monitor prompt's notification reads as its description and command, not as JSON", async () => {
  const { cli } = askingEach([{ id: ID, toolName: "Monitor", input: MONITOR }], (id) => decidePermission(db, id, { allow: true, decidedBy: "krister" }).then(() => {}));
  const run = await runPlanner(cli);
  const [note] = await db.select().from(notifications).where(eq(notifications.runId, run.id));
  expect(note!.body).toBe("e2e run finishing (re-arm) · until grep -q finished /tmp/e2e.log; do sleep 5; done");
});

test("after Always allow, the step's next matching call is allowed without asking, and the run records it", async () => {
  const again = "3f6b2a10-0000-4000-8000-000000000002";
  const other = "3f6b2a10-0000-4000-8000-000000000003";
  const { cli, answers } = askingEach(
    [
      { id: ID, toolName: "Monitor", input: MONITOR },
      { id: again, toolName: "Monitor", input: { ...MONITOR, description: "e2e run finishing (re-arm 2)" } },
      { id: other, toolName: "Bash", input: { command: "rm -rf dist" } },
    ],
    (id) => decidePermission(db, id, id === ID ? { allow: true, decidedBy: "krister", rule: "Monitor" } : { allow: false, decidedBy: "krister" }).then(() => {}),
  );
  const run = await runPlanner(cli);
  expect(answers).toEqual({ [ID]: { behavior: "allow" }, [again]: { behavior: "allow" }, [other]: { behavior: "deny" } });
  const [auto] = await db.select().from(permissionRequests).where(eq(permissionRequests.id, again));
  expect(auto).toMatchObject({ status: "allowed", rule: "Monitor", decidedBy: "always allow" });
  // Only the calls a person answered told them.
  expect(await db.select().from(notifications).where(eq(notifications.runId, run.id))).toHaveLength(2);
  const recorded = await db.select().from(events).where(and(eq(events.runId, run.id), eq(events.type, "permission.auto_allowed")));
  expect(recorded.map((e) => e.payload)).toEqual([{ id: again, toolName: "Monitor", input: { ...MONITOR, description: "e2e run finishing (re-arm 2)" }, rule: "Monitor", decidedBy: "always allow" }]);
});

test("a call the node's own allow list covers in handoff's reading is allowed without asking, and the run records it", async () => {
  const loop = "3f6b2a10-0000-4000-8000-000000000002";
  const other = "3f6b2a10-0000-4000-8000-000000000003";
  const asked: string[] = [];
  // The planner's list has Bash(echo *), Bash(pnpm *) and Bash(head *), and no rule for rm.
  const { cli, answers } = askingEach(
    [
      { id: ID, toolName: "Bash", input: { command: "echo $X" } },
      { id: loop, toolName: "Bash", input: { command: "for p in a b; do pnpm view $p time --json | head -5; done" } },
      { id: other, toolName: "Bash", input: { command: "for p in a b; do rm -rf $p; done" } },
    ],
    (id) => {
      asked.push(id);
      return decidePermission(db, id, { allow: false, decidedBy: "krister" }).then(() => {});
    },
  );
  const run = await runPlanner(cli);
  expect(asked).toEqual([other]);
  expect(answers).toEqual({ [ID]: { behavior: "allow" }, [loop]: { behavior: "allow" }, [other]: { behavior: "deny" } });
  const rows = await db.select().from(permissionRequests).where(inArray(permissionRequests.id, [ID, loop]));
  expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toMatchObject([
    { status: "allowed", rule: "Bash(echo *)", decidedBy: "node allow list" },
    { status: "allowed", rule: "Bash(pnpm *)", decidedBy: "node allow list" },
  ]);
  expect(await db.select().from(notifications).where(eq(notifications.runId, run.id))).toHaveLength(1);
  const recorded = await db.select().from(events).where(and(eq(events.runId, run.id), eq(events.type, "permission.auto_allowed")));
  expect(recorded.map((e) => e.payload)).toEqual([
    { id: ID, toolName: "Bash", input: { command: "echo $X" }, rule: "Bash(echo *)", decidedBy: "node allow list" },
    { id: loop, toolName: "Bash", input: { command: "for p in a b; do pnpm view $p time --json | head -5; done" }, rule: "Bash(pnpm *)", decidedBy: "node allow list" },
  ]);
  // A rule from the node's list is not a person's Always allow.
  expect(await runAllowRules(db, run.id, "planner")).toEqual([]);
});

test("a later attempt of the node gets the run's Always allow rules in its allowed tools", async () => {
  const { cli } = askingEach([{ id: ID, toolName: "Monitor", input: MONITOR }], (id) => decidePermission(db, id, { allow: true, decidedBy: "krister", rule: "Monitor" }).then(() => {}), {
    outcome: "error",
    exitCode: 1,
    stderrTail: "boom",
  });
  const run = await runPlanner(cli);
  const [failed] = await db.select().from(nodeExecutions).where(and(eq(nodeExecutions.runId, run.id), eq(nodeExecutions.status, "failed")));
  expect(cli.requests[0]!.allowedTools).not.toContain("Monitor");
  cli.push({ output: outputs.planner });
  await repairNodeExecution(db, failed!.id, {});
  await drain(engineDeps(db, { planner: cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000, permissions: { db } }), coder: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }) }));
  expect(cli.requests[1]!.allowedTools).toContain("Monitor");
});

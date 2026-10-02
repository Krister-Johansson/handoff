import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import type { CliRunOptions, CliRunRequest, CliRunResult } from "@handoff/cli-adapter";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { eq, notifications, permissionRequests, projects } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cliNodeExecutor } from "../executors/cli-node.ts";
import { decidePermission } from "../operations.ts";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { outputs, scripted } from "../testing/scripted.ts";
import { PERMISSION_TOOL } from "./broker.ts";

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
function asking(person?: () => Promise<void>) {
  const seen: { tool?: string | undefined; held?: boolean; response?: unknown } = {};
  const cli = new FakeCliExecutor([
    async (request: CliRunRequest, options: CliRunOptions): Promise<CliRunResult> => {
      seen.tool = request.permissionPromptTool;
      const dir = (JSON.parse(readFileSync(request.mcpConfigPath!, "utf8")) as McpConfig).mcpServers.handoff!.args[1]!;
      writeFileSync(join(dir, `${ID}.request.json`), JSON.stringify({ id: ID, toolName: "Bash", input: { command: "git -C /w log --oneline -8" } }));
      await requestRow();
      seen.held = options.holdIdle?.() ?? false;
      if (person) {
        await person();
        const response = join(dir, `${ID}.response.json`);
        seen.response = await until(() => (existsSync(response) ? JSON.parse(readFileSync(response, "utf8")) : undefined));
      }
      await options.onSessionId?.(request.session.id);
      return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, structuredOutput: outputs.planner, validated: outputs.planner };
    },
  ]);
  return { cli, seen };
}

async function runPlanner(cli: FakeCliExecutor) {
  const { run } = await startRun(db, linear);
  const planner = cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000, permissions: { db } });
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

test("a request nobody answered expires when the step ends", async () => {
  const { cli } = asking();
  const run = await runPlanner(cli);
  const [row] = await db.select().from(permissionRequests).where(eq(permissionRequests.runId, run.id));
  expect(row!.status).toBe("expired");
  await expect(decidePermission(db, ID, { allow: true, decidedBy: "late" })).rejects.toThrow(/already/);
});

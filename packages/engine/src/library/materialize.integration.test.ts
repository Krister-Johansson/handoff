import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import loop from "@handoff/core/fixtures/loop.graph.json" with { type: "json" };
import type { CliRunRequest, CliRunResult } from "@handoff/cli-adapter";
import { FakeCliExecutor } from "@handoff/cli-adapter/testing";
import { upsertAgent, upsertMcpServer, upsertSkill } from "@handoff/db";
import { createTestDb, truncateAll } from "@handoff/db/testing";
import { cliNodeExecutor } from "../executors/cli-node.ts";
import { drain, engineDeps, inspect, startRun } from "../testing/harness.ts";
import { done, outputs, scripted } from "../testing/scripted.ts";
import type { ExecutorRegistry } from "../types.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

type Seen = { request: CliRunRequest; files: Record<string, string>; mcp?: unknown };

/** Fake CLI reply that snapshots what the engine staged, since staging is removed afterwards. */
function capture(seen: Seen[], output: unknown, init: Record<string, unknown> = {}) {
  return async (request: CliRunRequest, options: { onEvent: (e: { type: string; payload: unknown }) => void | Promise<void>; onSessionId?: (id: string) => void | Promise<void> }): Promise<CliRunResult> => {
    const files: Record<string, string> = {};
    for (const dir of request.addDirs) {
      const skillsDir = join(dir, ".claude", "skills");
      if (!existsSync(skillsDir)) continue;
      const { readdirSync } = await import("node:fs");
      for (const name of readdirSync(skillsDir)) files[name] = readFileSync(join(skillsDir, name, "SKILL.md"), "utf8");
    }
    seen.push({ request, files, ...(request.mcpConfigPath ? { mcp: JSON.parse(readFileSync(request.mcpConfigPath, "utf8")) } : {}) });
    await options.onSessionId?.(request.session.id);
    await options.onEvent({ type: "cli.system.init", payload: { type: "system", subtype: "init", mcp_servers: [], ...init } });
    return { outcome: "success", exitCode: 0, stderrTail: "", sessionId: request.session.id, validated: output, structuredOutput: output };
  };
}

function graphWithLibrary(library: Record<string, string[]>, overrides?: Record<string, string[]>) {
  const doc = structuredClone(loop);
  (doc.nodes.find((n) => n.key === "coder")!.attributes as Record<string, unknown>).library = library;
  if (overrides) (doc.edges.find((e) => e.key === "tester->coder")!.attributes as Record<string, unknown>).overrides = overrides;
  return doc;
}

function registry(cli: FakeCliExecutor, overrides: Partial<ExecutorRegistry> = {}): ExecutorRegistry {
  return {
    planner: scripted(done(outputs.planner, { plan: outputs.planner })),
    coder: cliNodeExecutor({ cli, maxTurns: 10, timeoutMs: 60_000 }),
    tester: scripted(done(outputs.testsPass)),
    reviewer: scripted({ kind: "waiting", wait: { kind: "human", token: crypto.randomUUID() } }),
    ...overrides,
  };
}

test("enabled skills are written as SKILL.md under the staging dir and passed with --add-dir", async () => {
  await upsertSkill(db, { name: "tdd", description: "Test first", body: "Write the failing test first.", files: [{ path: "examples.md", content: "x" }] });
  const seen: Seen[] = [];
  const { run } = await startRun(db, graphWithLibrary({ skills: ["tdd"] }));
  const deps = engineDeps(db, registry(new FakeCliExecutor([capture(seen, outputs.coderDone)])));
  await drain(deps);
  expect(seen[0]!.request.addDirs).toHaveLength(1);
  expect(seen[0]!.files.tdd).toBe("---\nname: tdd\ndescription: Test first\n---\n\nWrite the failing test first.\n");
  expect(existsSync(seen[0]!.request.addDirs[0]!)).toBe(false);
  const coder = (await inspect(db, run.id)).events.find((e) => e.type === "library.materialized");
  expect(coder?.payload).toMatchObject({ skills: [{ name: "tdd", version: 1 }] });
});

test("a skill's frontmatter beyond name and description is written back to its SKILL.md", async () => {
  await upsertSkill(db, { name: "tdd", description: "Test first", body: "Body.", frontmatter: { license: "MIT", "allowed-tools": "Read, Edit" } });
  const seen: Seen[] = [];
  await startRun(db, graphWithLibrary({ skills: ["tdd"] }));
  await drain(engineDeps(db, registry(new FakeCliExecutor([capture(seen, outputs.coderDone)]))));
  expect(seen[0]!.files.tdd).toBe("---\nname: tdd\ndescription: Test first\nlicense: MIT\nallowed-tools: Read, Edit\n---\n\nBody.\n");
});

test("mcp.json resolves secrets from the engine environment and never from the database", async () => {
  await upsertMcpServer(db, { name: "docs", transport: "stdio", command: "npx", args: ["docs-mcp"], env: { API_KEY: "${secret:DOCS_KEY}", MODE: "fast" } });
  await upsertMcpServer(db, { name: "search", transport: "http", url: "https://mcp.example.com", headers: { Authorization: "Bearer ${secret:SEARCH_TOKEN}" }, tools: ["query"] });
  const seen: Seen[] = [];
  await startRun(db, graphWithLibrary({ mcp: ["docs", "search"] }));
  await drain(engineDeps(db, registry(new FakeCliExecutor([capture(seen, outputs.coderDone)])), { secrets: { DOCS_KEY: "k-123", SEARCH_TOKEN: "t-456" } }));
  expect(seen[0]!.mcp).toEqual({
    mcpServers: {
      docs: { type: "stdio", command: "npx", args: ["docs-mcp"], env: { API_KEY: "k-123", MODE: "fast" } },
      search: { type: "http", url: "https://mcp.example.com", headers: { Authorization: "Bearer t-456" } },
    },
  });
  expect(seen[0]!.request.allowedTools).toEqual(expect.arrayContaining(["mcp__docs__*", "mcp__search__query"]));
});

test("an mcp server with a missing secret fails the execution before spawning", async () => {
  await upsertMcpServer(db, { name: "docs", transport: "stdio", command: "npx", env: { API_KEY: "${secret:DOCS_KEY}" } });
  const cli = new FakeCliExecutor([]);
  const { run } = await startRun(db, graphWithLibrary({ mcp: ["docs"] }));
  await drain(engineDeps(db, registry(cli), { secrets: {} }));
  expect(cli.requests).toHaveLength(0);
  expect((await inspect(db, run.id)).executions.find((e) => e.nodeKey === "coder")).toMatchObject({
    status: "failed",
    error: { code: "library_unavailable", message: expect.stringContaining("DOCS_KEY") },
  });
});

test("a node naming a library entry that does not exist fails with the missing names", async () => {
  const { run } = await startRun(db, graphWithLibrary({ skills: ["ghost"] }));
  await drain(engineDeps(db, registry(new FakeCliExecutor([]))));
  expect((await inspect(db, run.id)).executions.find((e) => e.nodeKey === "coder")?.error).toMatchObject({ code: "library_unavailable", message: expect.stringContaining("skill ghost") });
});

test("a loop edge override adds a skill only on retry", async () => {
  await upsertSkill(db, { name: "tdd", description: "d", body: "b" });
  await upsertSkill(db, { name: "ci-triage", description: "Read failing tests", body: "Start from the failing test." });
  const seen: Seen[] = [];
  const cli = new FakeCliExecutor([capture(seen, outputs.coderDone), capture(seen, outputs.coderDone)]);
  await startRun(db, graphWithLibrary({ skills: ["tdd"] }, { skills: ["ci-triage"] }));
  await drain(engineDeps(db, registry(cli, { tester: scripted(done(outputs.testsFail), done(outputs.testsPass)) })));
  expect(Object.keys(seen[0]!.files)).toEqual(["tdd"]);
  expect(Object.keys(seen[1]!.files).sort()).toEqual(["ci-triage", "tdd"]);
});

test("library agents are passed to the CLI as subagent definitions", async () => {
  await upsertAgent(db, { name: "explorer", description: "Finds relevant code", prompt: "Search the repo.", tools: ["Read", "Grep"], model: "haiku" });
  const seen: Seen[] = [];
  await startRun(db, graphWithLibrary({ agents: ["explorer"] }));
  await drain(engineDeps(db, registry(new FakeCliExecutor([capture(seen, outputs.coderDone)]))));
  expect(seen[0]!.request.agents).toEqual({ explorer: { description: "Finds relevant code", prompt: "Search the repo.", tools: ["Read", "Grep"], model: "haiku" } });
});

test("MCP servers that fail to start fail the node", async () => {
  await upsertMcpServer(db, { name: "docs", transport: "http", url: "https://mcp.example.com" });
  const seen: Seen[] = [];
  const { run } = await startRun(db, graphWithLibrary({ mcp: ["docs"] }));
  await drain(engineDeps(db, registry(new FakeCliExecutor([capture(seen, outputs.coderDone, { mcp_servers: [{ name: "docs", status: "failed" }] })]))));
  expect((await inspect(db, run.id)).executions.find((e) => e.nodeKey === "coder")?.error).toMatchObject({ code: "mcp_unavailable" });
});

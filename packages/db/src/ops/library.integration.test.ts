import { afterAll, beforeEach, expect, test } from "vitest";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { deleteLibraryEntry, getLibraryByNames, listLibrary, upsertAgent, upsertMcpServer, upsertSkill } from "./library.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

test("upserting a skill creates version 1 and bumps the version on change", async () => {
  const first = await upsertSkill(db, { name: "tdd", description: "Test first", body: "Write the test first." });
  const second = await upsertSkill(db, { name: "tdd", description: "Test first", body: "Write the failing test first." });
  expect([first.version, second.version]).toEqual([1, 2]);
  expect((await listLibrary(db)).skills.map((s) => [s.name, s.version])).toEqual([["tdd", 2]]);
});

test("getLibraryByNames returns only the requested entries and reports missing names", async () => {
  await upsertSkill(db, { name: "tdd", description: "d", body: "b" });
  await upsertMcpServer(db, { name: "docs", transport: "http", url: "https://example.com/mcp" });
  await upsertAgent(db, { name: "explorer", description: "reads code", prompt: "Explore." });
  const found = await getLibraryByNames(db, { skills: ["tdd", "ghost"], mcp: ["docs"], agents: ["explorer"] });
  expect(found.skills.map((s) => s.name)).toEqual(["tdd"]);
  expect(found.mcp.map((s) => s.name)).toEqual(["docs"]);
  expect(found.agents.map((s) => s.name)).toEqual(["explorer"]);
  expect(found.missing).toEqual(["skill ghost"]);
});

test("an MCP server stores secret references, not values", async () => {
  const server = await upsertMcpServer(db, { name: "gh", transport: "stdio", command: "npx", args: ["mcp"], env: { TOKEN: "${secret:MCP_GH_TOKEN}" } });
  expect(server.env).toEqual({ TOKEN: "${secret:MCP_GH_TOKEN}" });
});

test("deleting an entry removes it", async () => {
  await upsertSkill(db, { name: "tdd", description: "d", body: "b" });
  await deleteLibraryEntry(db, "skill", "tdd");
  expect((await listLibrary(db)).skills).toEqual([]);
});

import { afterAll, beforeEach, expect, test } from "vitest";
import { truncateAll } from "../testing/reset.ts";
import { createTestDb } from "../testing/test-db.ts";
import { deleteLibraryEntry, getLibraryByNames, listLibrary, listLibraryIndex, recordMcpCheck, setMcpAllowedTools, upsertAgent, upsertGroup, upsertMcpServer, upsertSkill } from "./library.ts";

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

test("an http MCP server signs in with OAuth or sends headers, headers by default", async () => {
  expect((await upsertMcpServer(db, { name: "plain", transport: "http", url: "https://example.com/mcp" })).auth).toBe("headers");
  const oauth = await upsertMcpServer(db, { name: "context7", transport: "http", url: "https://mcp.context7.com/mcp/oauth", auth: "oauth" });
  expect(oauth.auth).toBe("oauth");
});

test("choosing an MCP server's allowed tools makes a new version and keeps its last check", async () => {
  await upsertMcpServer(db, { name: "context7", transport: "http", url: "https://mcp.context7.com/mcp/oauth" });
  await recordMcpCheck(db, "context7", { status: "ok", tools: [{ name: "resolve-library-id" }, { name: "query-docs" }] });
  const row = await setMcpAllowedTools(db, "context7", ["query-docs"]);
  expect(row).toMatchObject({ version: 2, tools: ["query-docs"], lastCheck: { status: "ok" } });
  expect(await setMcpAllowedTools(db, "ghost", [])).toBeUndefined();
});

test("deleting an entry removes it", async () => {
  await upsertSkill(db, { name: "tdd", description: "d", body: "b" });
  await deleteLibraryEntry(db, "skill", "tdd");
  expect((await listLibrary(db)).skills).toEqual([]);
});

test("a group bundles entries under a name and is versioned like them", async () => {
  const first = await upsertGroup(db, { name: "frontend", description: "UI work", skills: ["tdd", "shadcn"], mcp: ["docs"], agents: [] });
  const second = await upsertGroup(db, { name: "frontend", description: "UI work", skills: ["tdd"], mcp: [], agents: ["explorer"] });
  expect([first.version, second.version]).toEqual([1, 2]);
  expect((await listLibrary(db)).groups.map((g) => [g.name, g.skills, g.agents])).toEqual([["frontend", ["tdd"], ["explorer"]]]);
});

test("getLibraryByNames expands groups into their entries, merged with names given directly", async () => {
  await upsertSkill(db, { name: "tdd", description: "d", body: "b" });
  await upsertSkill(db, { name: "shadcn", description: "d", body: "b" });
  await upsertAgent(db, { name: "explorer", description: "reads code", prompt: "Explore." });
  await upsertGroup(db, { name: "frontend", description: "", skills: ["shadcn", "tdd"], mcp: [], agents: ["explorer"] });
  const found = await getLibraryByNames(db, { skills: ["tdd"], mcp: [], agents: [], groups: ["frontend"] });
  expect(found.skills.map((s) => s.name).sort()).toEqual(["shadcn", "tdd"]);
  expect(found.agents.map((a) => a.name)).toEqual(["explorer"]);
  expect(found.missing).toEqual([]);
});

test("a missing group, or a group naming a missing entry, is reported", async () => {
  await upsertGroup(db, { name: "stale", description: "", skills: ["gone"], mcp: [], agents: [] });
  expect((await getLibraryByNames(db, { skills: [], mcp: [], agents: [], groups: ["stale", "nope"] })).missing).toEqual(["group nope", "skill gone"]);
});

test("listLibraryIndex describes every entry without file contents", async () => {
  await upsertSkill(db, {
    name: "canvas",
    description: "Posters",
    body: "b",
    files: [{ path: "fonts/a.ttf", content: "AAEA", encoding: "base64" }, { path: "notes.md", content: "x" }],
    source: { registry: "github", id: "anthropics/skills/skills/canvas", hash: "t1" },
  });
  await upsertGroup(db, { name: "g", description: "", skills: ["canvas"], mcp: [], agents: [] });
  const index = await listLibraryIndex(db);
  expect(index.skills).toEqual([{ name: "canvas", description: "Posters", version: 1, fileCount: 2, source: { registry: "github", id: "anthropics/skills/skills/canvas", hash: "t1" } }]);
  expect(index.groups.map((g) => g.name)).toEqual(["g"]);
});

test("an MCP server keeps its last check until it is saved again", async () => {
  await upsertMcpServer(db, { name: "docs", transport: "http", url: "https://example.com/mcp" });
  const check = { status: "ok", checkedAt: "2026-09-30T10:00:00Z", durationMs: 120, tools: [{ name: "search" }], resources: 0, prompts: 0 };
  await recordMcpCheck(db, "docs", check);
  expect((await listLibraryIndex(db)).mcp[0]!.lastCheck).toEqual(check);
  await upsertMcpServer(db, { name: "docs", transport: "http", url: "https://example.com/mcp/v2" });
  expect((await listLibraryIndex(db)).mcp[0]!.lastCheck).toBeNull();
});

test("deleting a skill takes it out of the groups that list it", async () => {
  await upsertSkill(db, { name: "tdd", description: "d", body: "b" });
  await upsertSkill(db, { name: "pdf", description: "d", body: "b" });
  await upsertGroup(db, { name: "g", description: "", skills: ["pdf", "tdd"], mcp: [], agents: [] });
  await deleteLibraryEntry(db, "skill", "tdd");
  expect((await listLibraryIndex(db)).groups[0]!.skills).toEqual(["pdf"]);
  expect((await getLibraryByNames(db, { skills: [], mcp: [], agents: [], groups: ["g"] })).missing).toEqual([]);
});

test("deleting a group leaves an agent of the same name alone", async () => {
  await upsertAgent(db, { name: "same", description: "d", prompt: "p" });
  await upsertGroup(db, { name: "same", description: "", skills: [], mcp: [], agents: ["same"] });
  await deleteLibraryEntry(db, "group", "same");
  expect((await listLibraryIndex(db)).agents.map((a) => a.name)).toEqual(["same"]);
});

import { beforeEach, expect, test, vi } from "vitest";

const runTool = vi.hoisted(() => vi.fn<(deps: unknown, name: string, args: unknown) => Promise<unknown>>(async () => [{ name: "sandbox", runs: 15 }]));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/github", () => ({ getGitHub: () => undefined }));
vi.mock("@/server/agent-mcp", () => ({ runTool }));

beforeEach(() => runTool.mockClear());

const call = (name: string, body: unknown, origin = "http://127.0.0.1:3000") =>
  import("./route").then(({ POST }) =>
    POST(new Request(`http://127.0.0.1:3000/api/assistant/tools/${name}`, { method: "POST", headers: { origin, host: "127.0.0.1:3000", "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ name }),
    }),
  );

test("refuses another origin, an unknown tool and arguments that fail the catalog's schema", async () => {
  expect((await call("list_projects", {}, "https://evil.example")).status).toBe(403);
  expect((await call("drop_tables", {})).status).toBe(404);
  // UI tools run in the page, never on the server.
  expect((await call("go_to", { path: "/inbox" })).status).toBe(404);
  const bad = await call("cancel_run", { reason: "no run id" });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toMatchObject({ error: expect.stringContaining("run_id") });
  expect(runTool).not.toHaveBeenCalled();
});

test("runs a read tool and returns its JSON", async () => {
  const response = await call("list_runs", { project: "sandbox", status: "active" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ result: [{ name: "sandbox", runs: 15 }] });
  expect(runTool).toHaveBeenCalledWith(expect.objectContaining({ actor: "webmcp", baseUrl: "http://127.0.0.1:3000" }), "list_runs", { project: "sandbox", status: "active" });
});

test("a tool that fails answers with its message", async () => {
  runTool.mockRejectedValueOnce(new Error("There is no project nowhere."));
  const response = await call("get_project", { project: "nowhere" });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ error: "There is no project nowhere." });
});

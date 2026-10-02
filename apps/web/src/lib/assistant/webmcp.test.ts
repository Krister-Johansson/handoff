/// <reference types="webmcp-types" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { CATALOG } from "./catalog";
import { registerWebMcp, type WebMcpHost } from "./webmcp";

/** A stand-in for the browser's document.modelContext: it keeps registered tools until their signal aborts. */
class StubModelContext extends EventTarget {
  tools = new Map<string, WebMCP.ModelContextTool>();
  async registerTool(tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) {
    this.tools.set(tool.name, tool);
    options?.signal?.addEventListener("abort", () => this.tools.delete(tool.name));
  }
  async getTools() {
    return [...this.tools.values()];
  }
  async executeTool(name: string, input: object) {
    return String(await this.tools.get(name)!.execute(input as Record<string, unknown>, { signal: new AbortController().signal }));
  }
}

let context: StubModelContext;
let controller: AbortController;
let host: WebMcpHost & { approve: ReturnType<typeof vi.fn>; runUi: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> };

beforeEach(() => {
  context = new StubModelContext();
  controller = new AbortController();
  host = {
    approve: vi.fn(async () => ({ approved: true })),
    runUi: vi.fn(async () => ({ text: "Opened Inbox (/inbox).", isError: false })),
    fetch: vi.fn(async () => Response.json({ result: [{ name: "sandbox" }] })),
  };
});
afterEach(() => controller.abort());

const register = (available = true, ctx: StubModelContext | null = context) =>
  registerWebMcp((ctx ?? undefined) as unknown as WebMCP.ModelContext | undefined, host, { available, signal: controller.signal });

test("registers every catalog tool with its JSON Schema and annotations when modelContext exists, and nothing when it does not", async () => {
  expect(await register(true, null)).toBe(0);
  expect(await register()).toBe(CATALOG.length);
  expect([...context.tools.keys()].sort()).toEqual(CATALOG.map((t) => t.name).sort());
  const merge = context.tools.get("request_merge")!;
  expect(merge).toMatchObject({ title: "Merge a pull request", description: expect.stringContaining("merge"), inputSchema: z.toJSONSchema(CATALOG.find((t) => t.name === "request_merge")!.input) });
  expect(merge.annotations).toEqual({ readOnlyHint: false, consequentialHint: true, untrustedContentHint: false });
  expect(context.tools.get("get_run")!.annotations).toEqual({ readOnlyHint: true, consequentialHint: false, untrustedContentHint: true });
});

test("aborting the signal unregisters the tools", async () => {
  await register();
  controller.abort();
  expect(await context.getTools()).toEqual([]);
});

test("a data tool executes through the dashboard's tools route and returns its text", async () => {
  await register();
  const text = await context.executeTool("list_runs", { project: "sandbox" });
  expect(JSON.parse(text)).toEqual([{ name: "sandbox" }]);
  expect(host.fetch).toHaveBeenCalledWith("/api/assistant/tools/list_runs", expect.objectContaining({ method: "POST", body: JSON.stringify({ project: "sandbox" }) }));
  expect(host.approve).not.toHaveBeenCalled();
});

test("a failing data tool rejects with the route's message", async () => {
  host.fetch.mockResolvedValueOnce(Response.json({ error: "There is no project nowhere." }, { status: 422 }));
  await register();
  await expect(context.executeTool("get_project", { project: "nowhere" })).rejects.toThrow("There is no project nowhere.");
});

test("a confirm tool opens the approval dialog and runs only after Approve, and returns a denial text after Deny", async () => {
  await register();
  let approve: (a: { approved: boolean; note?: string }) => void = () => {};
  host.approve.mockImplementationOnce(() => new Promise((resolve) => (approve = resolve)));
  const running = context.executeTool("cancel_run", { run_id: "7f3a1b2c-0000-4000-8000-000000000000" });
  await vi.waitFor(() => expect(host.approve).toHaveBeenCalledWith({ name: "cancel_run", title: "Cancel a run", summary: "Cancel run 7f3a1b2c", args: { run_id: "7f3a1b2c-0000-4000-8000-000000000000" } }));
  expect(host.fetch).not.toHaveBeenCalled();
  approve({ approved: true });
  await running;
  expect(host.fetch).toHaveBeenCalledWith("/api/assistant/tools/cancel_run", expect.anything());

  host.fetch.mockClear();
  host.approve.mockResolvedValueOnce({ approved: false, note: "Let it finish" });
  const denied = await context.executeTool("cancel_run", { run_id: "7f3a1b2c-0000-4000-8000-000000000000" });
  expect(denied).toBe("The person did not approve this: Let it finish. Do not try it again.");
  expect(host.fetch).not.toHaveBeenCalled();
});

test("a ui tool runs in the page", async () => {
  await register();
  expect(await context.executeTool("go_to_inbox", {})).toBe("Opened Inbox (/inbox).");
  expect(host.runUi).toHaveBeenCalledWith({ name: "go_to_inbox", args: {} });
  expect(host.fetch).not.toHaveBeenCalled();
});

test("with the assistant unavailable only read and ui tools register", async () => {
  await register(false);
  const names = [...context.tools.keys()];
  expect(names).toContain("list_runs");
  expect(names).toContain("go_to");
  expect(names).not.toContain("cancel_run");
  expect(names).not.toContain("dismiss_attention");
  expect(names.sort()).toEqual(CATALOG.filter((t) => t.readOnly && !t.confirm).map((t) => t.name).sort());
});

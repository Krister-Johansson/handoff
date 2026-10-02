/// <reference types="webmcp-types" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { CATALOG } from "./catalog";
import { pageToolSpec } from "./page-tools";
import { runPageTool, type OpenPage } from "./run-page-tool";
import { pageToolsOnWebMcp, registerPageTools, registerWebMcp, type WebMcpHost } from "./webmcp";

/**
 * A stand-in for the browser's document.modelContext: it keeps registered tools until their signal
 * aborts, and like the specification rejects a name that is already registered. `log` records each
 * registration and removal in order; a name in `refuse` is rejected as a browser quirk would.
 */
class StubModelContext extends EventTarget {
  tools = new Map<string, WebMCP.ModelContextTool>();
  log: string[] = [];
  refuse = new Set<string>();
  async registerTool(tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) {
    if (this.tools.has(tool.name) || this.refuse.has(tool.name)) throw new DOMException(`${tool.name} is already registered.`, "InvalidStateError");
    this.tools.set(tool.name, tool);
    this.log.push(`+${tool.name}`);
    options?.signal?.addEventListener("abort", () => {
      this.tools.delete(tool.name);
      this.log.push(`-${tool.name}`);
    });
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
let host: WebMcpHost & { approve: ReturnType<typeof vi.fn>; runUi: ReturnType<typeof vi.fn>; runPage: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> };
/** The page that is open in these tests; host.runPage runs page tools against it, as the provider does. */
let open: OpenPage | undefined;

beforeEach(() => {
  context = new StubModelContext();
  controller = new AbortController();
  host = {
    approve: vi.fn(async () => ({ approved: true })),
    runUi: vi.fn(async () => ({ text: "Opened Inbox (/inbox).", isError: false })),
    runPage: vi.fn((call: { name: string; args: unknown }) => runPageTool(open, call)),
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

/** A Try it page in miniature: it binds the cursor and the submit, and leaves the rest unbound. */
function tryPage(submitted: string[] = []): OpenPage {
  return {
    kind: "try",
    handlers: {
      page_go_to_criterion: (({ index }: { index?: number }) => `Showing criterion ${index ?? 2}.`) as never,
      page_submit: (({ option }: { option: string }) => {
        submitted.push(option);
        return `Submitted ${option}.`;
      }) as never,
    },
    describe: () => ({ criteria: [] }),
  };
}

const registerPage = (page: OpenPage | undefined, available = true) =>
  registerPageTools(context as unknown as WebMCP.ModelContext, page, host, { available, signal: controller.signal });

test("a page's bound tools register with their JSON Schema and consequentialHint, and leave when their signal aborts", async () => {
  open = tryPage();
  expect(await registerPage(open)).toBe(2);
  expect([...context.tools.keys()].sort()).toEqual(["page_go_to_criterion", "page_submit"]);
  const submit = context.tools.get("page_submit")!;
  expect(submit).toMatchObject({ title: "Submit Try it", description: expect.stringContaining("approve"), inputSchema: z.toJSONSchema(pageToolSpec("page_submit")!.input) });
  expect(submit.annotations).toEqual({ readOnlyHint: false, consequentialHint: true, untrustedContentHint: false });
  expect(context.tools.get("page_go_to_criterion")!.annotations).toEqual({ readOnlyHint: true, consequentialHint: false, untrustedContentHint: false });
  expect(await context.executeTool("page_go_to_criterion", { index: 3 })).toBe("Showing criterion 3.");
  expect(host.approve).not.toHaveBeenCalled();

  controller.abort();
  expect(await context.getTools()).toEqual([]);
});

test("a confirm page tool runs its handler only after Approve and returns a denial text after Deny", async () => {
  const submitted: string[] = [];
  open = tryPage(submitted);
  await registerPage(open);
  let approve: (a: { approved: boolean; note?: string }) => void = () => {};
  host.approve.mockImplementationOnce(() => new Promise((resolve) => (approve = resolve)));
  const running = context.executeTool("page_submit", { option: "approve" });
  await vi.waitFor(() => expect(host.approve).toHaveBeenCalledWith({ name: "page_submit", title: "Submit Try it", summary: "Approve the app", args: { option: "approve" } }));
  expect(submitted).toEqual([]);
  approve({ approved: true });
  expect(await running).toBe("Submitted approve.");
  expect(submitted).toEqual(["approve"]);

  host.approve.mockResolvedValueOnce({ approved: false, note: "Not yet" });
  expect(await context.executeTool("page_submit", { option: "changes" })).toBe("The person did not approve this: Not yet. Do not try it again.");
  expect(submitted).toEqual(["approve"]);
});

test("with the assistant unavailable a page's confirm tools do not register, since no approval card can show", async () => {
  open = tryPage();
  expect(await registerPage(open, false)).toBe(1);
  expect([...context.tools.keys()]).toEqual(["page_go_to_criterion"]);
});

test("re-registering after a page change aborts the old set before the new one, and a rejected registration does not throw", async () => {
  const pages = pageToolsOnWebMcp(context as unknown as WebMCP.ModelContext, host, { available: true });
  open = tryPage();
  expect(await pages.show(open)).toBe(2);

  // The same page again, as a re-render or React's development double effect registers it: the old names leave first.
  context.log = [];
  expect(await pages.show(open)).toBe(2);
  expect(context.log).toEqual(["-page_go_to_criterion", "-page_submit", "+page_go_to_criterion", "+page_submit"]);

  // Two changes before the first has registered: only the last page's tools stay.
  context.log = [];
  const review: OpenPage = { kind: "code_review", handlers: { page_go_to_file: (() => "Showing a.ts.") as never }, describe: () => ({}) };
  const first = pages.show(tryPage());
  open = review;
  expect(await pages.show(review)).toBe(1);
  expect(await first).toBe(0);
  expect(context.log).toEqual(["-page_go_to_criterion", "-page_submit", "+page_go_to_file"]);
  expect(await context.executeTool("page_go_to_file", {})).toBe("Showing a.ts.");

  // A browser that refuses one registration keeps the others, and nothing throws.
  context.refuse.add("page_submit");
  open = tryPage();
  await expect(pages.show(open)).resolves.toBe(1);
  expect([...context.tools.keys()]).toEqual(["page_go_to_criterion"]);

  // A page without tools, and closing, leave none.
  await pages.show(undefined);
  expect(context.tools.size).toBe(0);
  await pages.show(open);
  pages.clear();
  expect(context.tools.size).toBe(0);
});

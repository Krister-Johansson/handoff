import { expect, test, vi } from "vitest";
import { runViewTool } from "./view-tools";

const RUN = "7f3a2c1e-0000-4000-8000-000000000001";
const deps = (over: Partial<Parameters<typeof runViewTool>[1]> = {}) => ({
  approve: vi.fn(async () => ({ approved: true })),
  run: vi.fn(async (): Promise<unknown> => ({ id: RUN, status: "running" })),
  ...over,
});

test("a read-only tool runs at once, and the view gets its result as the MCP server gives it: JSON text", async () => {
  const d = deps();
  const result = await runViewTool({ name: "get_run", arguments: { run_id: RUN } }, d);
  expect(d.approve).not.toHaveBeenCalled();
  expect(d.run).toHaveBeenCalledWith("get_run", { run_id: RUN });
  expect(result).toEqual({ content: [{ type: "text", text: JSON.stringify({ id: RUN, status: "running" }, null, 2) }] });
});

test("a tool that needs approval asks first, with the catalog's title and summary; the click in the view is only the request", async () => {
  const d = deps({ run: vi.fn(async () => ({ id: RUN, status: "cancelled" })) });
  const result = await runViewTool({ name: "cancel_run", arguments: { run_id: RUN, reason: "wrong issue" } }, d);
  expect(d.approve).toHaveBeenCalledWith({ name: "cancel_run", title: "Cancel a run", summary: "Cancel run 7f3a2c1e: wrong issue", args: { run_id: RUN, reason: "wrong issue" } });
  expect(d.run).toHaveBeenCalledWith("cancel_run", { run_id: RUN, reason: "wrong issue" });
  expect(result.isError).toBeUndefined();
});

test("a tool the person does not approve does not run, and the view hears why", async () => {
  const d = deps({ approve: vi.fn(async () => ({ approved: false, note: "Let it finish" })) });
  const result = await runViewTool({ name: "answer_permission", arguments: { request_id: "p1", decision: "allow" } }, d);
  expect(d.run).not.toHaveBeenCalled();
  expect(result).toEqual({ content: [{ type: "text", text: "The person did not approve this: Let it finish." }], isError: true });
});

test("a view may call only the catalog's server tools, with arguments the catalog accepts", async () => {
  const d = deps();
  expect(await runViewTool({ name: "go_to", arguments: { path: "/inbox" } }, d)).toEqual({ content: [{ type: "text", text: "go_to is not a handoff tool a view can call." }], isError: true });
  expect(await runViewTool({ name: "drop_tables" }, d)).toMatchObject({ isError: true });
  const bad = await runViewTool({ name: "cancel_run", arguments: { reason: "no id" } }, d);
  expect(bad).toMatchObject({ isError: true, content: [{ type: "text", text: expect.stringContaining("run_id") }] });
  expect(d.approve).not.toHaveBeenCalled();
  expect(d.run).not.toHaveBeenCalled();
});

test("a tool that fails gives the view its message as a tool error", async () => {
  const d = deps({ run: vi.fn(async () => Promise.reject(new Error("There is no run nope."))) });
  expect(await runViewTool({ name: "get_run", arguments: { run_id: "nope" } }, d)).toEqual({ content: [{ type: "text", text: "There is no run nope." }], isError: true });
});

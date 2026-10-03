import { expect, test } from "vitest";
import { closeTurn, openTurn, type TurnEvent } from "./relay";
import { handleTurnMcpRequest } from "./turn-mcp";

const deps = { db: {} as never, github: undefined, baseUrl: "http://localhost:3000", approvalTimeoutMs: 1000, uiTimeoutMs: 1000 };
const call = (headers: Record<string, string>) => handleTurnMcpRequest(new Request("http://localhost:3000/api/assistant/mcp", { method: "POST", headers, body: "{}" }), deps);

test("the MCP endpoint refuses a missing, wrong or expired turn token and a browser origin", async () => {
  expect((await call({})).status).toBe(401);
  expect((await call({ authorization: "Bearer not-a-turn" })).status).toBe(401);
  const turn = openTurn("c1");
  expect((await call({ authorization: `Bearer ${turn.token}`, origin: "http://localhost:3000" })).status).toBe(403);
  closeTurn(turn);
  expect((await call({ authorization: `Bearer ${turn.token}` })).status).toBe(401);
});

const runPage = { kind: "run" as const, path: "/projects/p1/runs/r1", heading: "Add a CHANGELOG.md", tools: ["page_show_view", "page_open_step"] };
const reviewPage = { kind: "code_review" as const, path: "/projects/p1/runs/r1/review/q1", heading: "Review", tools: ["page_go_to_file", "page_submit_review"] };

/** One JSON-RPC request to the turn's MCP endpoint, as Claude Code sends it. */
async function rpc(token: string, method: string, params: unknown) {
  const response = await handleTurnMcpRequest(
    new Request("http://localhost:3000/api/assistant/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    deps,
  );
  return ((await response.json()) as { result: Record<string, unknown> }).result;
}

type ListedTool = { name: string; title?: string; inputSchema: { properties?: Record<string, unknown> }; annotations?: Record<string, unknown> };

test("the turn's MCP server lists the catalog and the page's bound tools, with the page's annotations", async () => {
  const turn = openTurn("c1", runPage);
  try {
    const { tools } = (await rpc(turn.token, "tools/list", {})) as { tools: ListedTool[] };
    const names = tools.map((t) => t.name);
    // The catalog is all there, as on any turn.
    expect(names).toEqual(expect.arrayContaining(["list_runs", "cancel_run", "where_am_i", "go_to_run", "approve"]));
    // Only the tools the page bound, not the rest of its kind and not other pages' tools.
    expect(names.filter((n) => n.startsWith("page_"))).toEqual(["page_show_view", "page_open_step"]);
    const showView = tools.find((t) => t.name === "page_show_view")!;
    expect(showView.title).toBe("Show a view");
    expect(Object.keys(showView.inputSchema.properties ?? {})).toEqual(["view"]);
    expect(showView.annotations).toMatchObject({ title: "Show a view", readOnlyHint: true, openWorldHint: false });
  } finally {
    closeTurn(turn);
  }
  const review = openTurn("c2", reviewPage);
  try {
    const { tools } = (await rpc(review.token, "tools/list", {})) as { tools: ListedTool[] };
    expect(tools.find((t) => t.name === "page_submit_review")!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  } finally {
    closeTurn(review);
  }
  const plain = openTurn("c3");
  try {
    const { tools } = (await rpc(plain.token, "tools/list", {})) as { tools: ListedTool[] };
    expect(tools.some((t) => t.name.startsWith("page_"))).toBe(false);
  } finally {
    closeTurn(plain);
  }
});

test("approve puts a confirm page tool on a card with the spec's summary and allows a non-confirm one at once", async () => {
  const turn = openTurn("c1", reviewPage);
  const events: TurnEvent[] = [];
  turn.subscribe((e) => {
    events.push(e);
    if (e.type === "ui_check") setTimeout(() => turn.answerUi(e.requestId, { text: "page_submit_review can run on this page.", isError: false }), 10);
    if (e.type === "confirm") setTimeout(() => turn.answer(e.requestId, { approved: true }), 10);
  });
  const ask = async (tool_name: string, input: Record<string, unknown>) => {
    const { content } = (await rpc(turn.token, "tools/call", { name: "approve", arguments: { tool_name, input, tool_use_id: "toolu_1" } })) as { content: { text: string }[] };
    return JSON.parse(content[0]!.text) as { behavior: string; message?: string };
  };
  try {
    expect(await ask("mcp__handoff__page_go_to_file", { direction: "next" })).toMatchObject({ behavior: "allow" });
    expect(events.filter((e) => e.type === "confirm")).toEqual([]);

    expect(await ask("mcp__handoff__page_submit_review", { option: "changes" })).toMatchObject({ behavior: "allow" });
    expect(events.find((e) => e.type === "confirm")).toMatchObject({
      name: "page_submit_review",
      title: "Submit the review",
      summary: "Request changes, sending the comments back",
      args: { option: "changes" },
    });
    // The page checked the call before its card went up.
    expect(events.map((e) => e.type)).toEqual(["ui_check", "confirm", "confirmed"]);
    expect(events[0]).toMatchObject({ type: "ui_check", name: "page_submit_review", args: { option: "changes" } });

    // A page tool this turn's page did not bind is not one of this turn's tools.
    expect(await ask("mcp__handoff__page_save_graph", {})).toMatchObject({ behavior: "deny" });
  } finally {
    closeTurn(turn);
  }
});

const todooverkill = { id: "8f0c1a8e-0000-4000-8000-000000000151", name: "todooverkill" };
type SchemaTool = ListedTool & { description?: string; inputSchema: { required?: string[] } };

test("in a chat on a project, tools that take a project let the call leave it out and say they use the chat's project", async () => {
  const turn = openTurn("c1", undefined, todooverkill);
  try {
    const { tools } = (await rpc(turn.token, "tools/list", {})) as { tools: SchemaTool[] };
    const tool = (name: string) => tools.find((t) => t.name === name)!;
    for (const name of ["list_plan", "get_project", "list_backlog", "start_run", "move_to_ready"]) {
      expect(tool(name).inputSchema.required ?? []).not.toContain("project");
      expect(tool(name).description).toMatch(/Without project, it uses todooverkill, this chat's project\.$/);
    }
    // The UI tools that open a project's pages take this chat's project too.
    for (const name of ["set_project_tab", "go_to_plan"]) expect(tool(name).inputSchema.required ?? []).not.toContain("project_id");
    // An optional project stays a filter: without it, list_runs covers every project.
    expect(tool("list_runs").description).not.toMatch(/Without project/);
  } finally {
    closeTurn(turn);
  }
  const plain = openTurn("c2");
  try {
    const { tools } = (await rpc(plain.token, "tools/list", {})) as { tools: SchemaTool[] };
    expect(tools.find((t) => t.name === "list_plan")!.inputSchema.required).toContain("project");
    expect(tools.find((t) => t.name === "set_project_tab")!.inputSchema.required).toContain("project_id");
  } finally {
    closeTurn(plain);
  }
});

test("in a chat on a project, an approval card and a UI call name the chat's project when the call left it out", async () => {
  const turn = openTurn("c1", undefined, todooverkill);
  const events: TurnEvent[] = [];
  turn.subscribe((e) => {
    events.push(e);
    if (e.type === "confirm") setTimeout(() => turn.answer(e.requestId, { approved: true }), 10);
    if (e.type === "ui_call") setTimeout(() => turn.answerUi(e.requestId, { text: "Opened the plan.", isError: false }), 10);
  });
  try {
    const { content } = (await rpc(turn.token, "tools/call", {
      name: "approve",
      arguments: { tool_name: "mcp__handoff__move_to_ready", input: { issues: [151] }, tool_use_id: "toolu_1" },
    })) as { content: { text: string }[] };
    expect(JSON.parse(content[0]!.text)).toEqual({ behavior: "allow", updatedInput: { issues: [151], project: "todooverkill" } });
    expect(events.find((e) => e.type === "confirm")).toMatchObject({ summary: "Move task #151 to Ready in todooverkill", args: { issues: [151], project: "todooverkill" } });

    await rpc(turn.token, "tools/call", { name: "set_project_tab", arguments: { tab: "plan" } });
    expect(events.find((e) => e.type === "ui_call")).toMatchObject({ name: "set_project_tab", args: { tab: "plan", project_id: todooverkill.id } });
  } finally {
    closeTurn(turn);
  }
});

const tryPage = { kind: "try" as const, path: "/projects/p1/runs/r1/try/q1", heading: "Try it", tools: ["page_submit"] };

test("approve refuses a page tool the page would refuse, with the page's reason and no card", async () => {
  const turn = openTurn("c1", tryPage);
  const events: TurnEvent[] = [];
  turn.subscribe((e) => {
    events.push(e);
    if (e.type === "ui_check") setTimeout(() => turn.answerUi(e.requestId, { text: "Check every criterion to approve. Not marked as working: 2.", isError: true }), 10);
  });
  try {
    const { content } = (await rpc(turn.token, "tools/call", {
      name: "approve",
      arguments: { tool_name: "mcp__handoff__page_submit", input: { option: "approve" }, tool_use_id: "toolu_1" },
    })) as { content: { text: string }[] };
    expect(JSON.parse(content[0]!.text)).toEqual({
      behavior: "deny",
      message: "The page refused this, so the person was not asked: Check every criterion to approve. Not marked as working: 2.",
    });
    expect(events.map((e) => e.type)).toEqual(["ui_check"]);
  } finally {
    closeTurn(turn);
  }
});

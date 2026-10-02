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

    // A page tool this turn's page did not bind is not one of this turn's tools.
    expect(await ask("mcp__handoff__page_save_graph", {})).toMatchObject({ behavior: "deny" });
  } finally {
    closeTurn(turn);
  }
});

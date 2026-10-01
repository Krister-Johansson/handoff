import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ExecutionActivity } from "./execution-activity";

const ev = (seq: number, type: string, payload: unknown) => ({ seq, type, payload, nodeExecutionId: "e1", createdAt: "2026-10-01T10:00:00.000Z" });
const assistant = (seq: number, ...content: unknown[]) => ev(seq, "cli.assistant", { message: { content } });

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        events: [
          ev(1, "cli.system.init", { model: "claude-fable-5-1" }),
          assistant(2, { type: "thinking", thinking: "The docs want a temp dir." }),
          assistant(3, { type: "text", text: "Reading the docs first." }),
          assistant(4, { type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } }),
          ev(5, "cli.user", { message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "\u001b[32m✓\u001b[39m 1 passed" }] } }),
        ],
      }),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());

test("the drawer shows what the agent thought, said and ran, with each command's output", async () => {
  render(<ExecutionActivity runId="r1" executionId="e1" live={[]} />);
  expect(await screen.findByText("Reading the docs first.")).toBeInTheDocument();
  expect(screen.getByText("The docs want a temp dir.")).toBeInTheDocument();
  // Tool calls fold into one step; opening it shows each call, and opening a call its output.
  fireEvent.click(screen.getByText("Ran a command"));
  fireEvent.click(screen.getByText("pnpm test"));
  expect(screen.getByText("✓")).toBeInTheDocument();
  expect(screen.getByText(/claude-fable-5-1/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/runs/r1/executions/e1/events", expect.anything());
});

test("a step of tool calls counts its calls", async () => {
  render(<ExecutionActivity runId="r1" executionId="e1" live={[]} />);
  expect(await screen.findByText("1 tool")).toBeInTheDocument();
});

test("events that arrive while the node runs join the timeline", async () => {
  const { rerender } = render(<ExecutionActivity runId="r1" executionId="e1" live={[]} />);
  await screen.findByText("Reading the docs first.");
  rerender(<ExecutionActivity runId="r1" executionId="e1" live={[assistant(3, { type: "text", text: "Reading the docs first." }), assistant(6, { type: "text", text: "Now writing the scaffold." })]} />);
  expect(screen.getByText("Now writing the scaffold.")).toBeInTheDocument();
  expect(screen.getAllByText("Reading the docs first.")).toHaveLength(1);
});

test("the activity sits in a scroll area that follows new activity to the bottom", async () => {
  const { rerender, container } = render(<ExecutionActivity runId="r1" executionId="e1" live={[]} />);
  await screen.findByText("Reading the docs first.");
  const viewport = container.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")!;
  expect(viewport).not.toBeNull();
  Object.defineProperty(viewport, "scrollHeight", { configurable: true, value: 900 });
  Object.defineProperty(viewport, "clientHeight", { configurable: true, value: 300 });
  rerender(<ExecutionActivity runId="r1" executionId="e1" live={[assistant(6, { type: "text", text: "Now writing the scaffold." })]} />);
  expect(viewport.scrollTop).toBe(900);
});

test("a denied tool call says so, and one click allows it for the node from the next run on", async () => {
  const denied = "Permission for this tool use was denied. What required approval: This Bash command contains multiple operations. The following part requires approval: gh issue view 1";
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).endsWith("/allow-tool")) return Response.json({ graph: "master", version: 12, node: "planner-1" });
    return Response.json({
      events: [
        assistant(1, { type: "tool_use", id: "t1", name: "Bash", input: { command: "gh issue view 1" } }),
        ev(2, "cli.user", { message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: denied }] } }),
      ],
    });
  });
  render(<ExecutionActivity runId="r1" executionId="e1" live={[]} />);
  fireEvent.click(await screen.findByText("Ran a command"));
  expect(screen.getByText("1 denied")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Allow Bash(gh issue *) for this node" }));
  expect(await screen.findByText(/Saved as master v12/)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/runs/r1/executions/e1/allow-tool", expect.objectContaining({ method: "POST", body: JSON.stringify({ rule: "Bash(gh issue *)" }) }));
});

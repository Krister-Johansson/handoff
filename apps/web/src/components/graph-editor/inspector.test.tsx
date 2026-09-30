import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { FlowGraph } from "@handoff/core";
import { Inspector } from "./inspector";

const library = { skills: [], mcp: [], agents: [], groups: [] };
const graph: FlowGraph = {
  attributes: { startNode: "planner" },
  nodes: [
    { id: "planner", type: "handoff", position: { x: 0, y: 0 }, data: { nodeType: "planner", label: "Planner", isStart: true, config: {} } },
    { id: "reviewer", type: "handoff", position: { x: 300, y: 0 }, data: { nodeType: "reviewer", label: "Reviewer", isStart: false, config: {} } },
    { id: "gate", type: "handoff", position: { x: 600, y: 0 }, data: { nodeType: "human_gate", label: "Gate", isStart: false, config: {} } },
  ],
  edges: [
    { id: "reviewer->planner", source: "reviewer", target: "planner", sourceHandle: "changes", targetHandle: "feedback", type: "handoff", data: { on: "passed", loop: false, priority: 0, port: "changes", input: "feedback" } },
  ],
};

test("an edge says which port it leaves from and where it arrives, with its condition under Advanced", () => {
  render(<Inspector graph={graph} selection={{ edgeId: "reviewer->planner" }} library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.getByText(/Reviewer: changes/)).toBeInTheDocument();
  expect(screen.getByText(/Planner: feedback/)).toBeInTheDocument();
  expect(screen.getByLabelText("Max attempts")).toHaveValue(3);
  expect(screen.queryByLabelText("Condition")).not.toBeVisible();
  fireEvent.click(screen.getByText("Advanced"));
  expect(screen.getByLabelText("Condition")).toBeVisible();
});

test("a planner has instructions for its step and no PR feedback switch", () => {
  const dispatch = vi.fn();
  render(<Inspector graph={graph} selection={{ nodeId: "planner" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.queryByText(/Include PR feedback/)).not.toBeInTheDocument();
  const instructions = screen.getByLabelText("Instructions");
  fireEvent.change(instructions, { target: { value: "Keep the plan to five steps." } });
  fireEvent.blur(instructions);
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "planner", patch: { config: { instructions: "Keep the plan to five steps." } } });
});

test("a human gate either reviews what reaches it or answers a question", () => {
  const dispatch = vi.fn();
  render(<Inspector graph={graph} selection={{ nodeId: "gate" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("Mode")).toHaveValue("approval");
  fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "question" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "gate", patch: { config: { mode: "question" } } });
});

test("a node's library is shown as badges and chosen in a dialog", async () => {
  const dispatch = vi.fn();
  const choices = { ...library, skills: [{ name: "tdd", detail: "Test first", source: "mattpocock/skills" }, { name: "unslop", detail: "Plain prose", source: "Written here" }] };
  const withLibrary: FlowGraph = { ...graph, nodes: graph.nodes.map((n) => (n.id === "planner" ? { ...n, data: { ...n.data, library: { skills: ["unslop"], mcp: [], agents: [], groups: [] } } } : n)) };
  render(<Inspector graph={withLibrary} selection={{ nodeId: "planner" }} library={choices} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(within(screen.getByRole("list", { name: "Chosen library" })).getByText("unslop")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "tdd" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Choose" }));
  const dialog = await screen.findByRole("dialog", { name: "Library for Planner" });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "tdd" }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "planner", patch: { library: { skills: ["unslop", "tdd"], mcp: [], agents: [], groups: [] } } });

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Remove skill unslop" }));
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "planner", patch: { library: { skills: [], mcp: [], agents: [], groups: [] } } });
});

test("a step can pick its model and effort, or keep the worker's defaults", () => {
  const dispatch = vi.fn();
  render(<Inspector graph={graph} selection={{ nodeId: "planner" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("Model")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "opus" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "planner", patch: { config: { model: "opus" } } });
  fireEvent.change(screen.getByLabelText("Effort"), { target: { value: "xhigh" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "planner", patch: { config: { effort: "xhigh" } } });
});

test("a full model id can be typed when no alias fits", () => {
  const dispatch = vi.fn();
  const custom: FlowGraph = { ...graph, nodes: graph.nodes.map((n) => (n.id === "planner" ? { ...n, data: { ...n.data, config: { model: "claude-opus-5-5" } } } : n)) };
  render(<Inspector graph={custom} selection={{ nodeId: "planner" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("Model")).toHaveValue("custom");
  const id = screen.getByLabelText("Model id");
  expect(id).toHaveValue("claude-opus-5-5");
  fireEvent.change(id, { target: { value: "claude-sonnet-5-5" } });
  fireEvent.blur(id);
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "planner", patch: { config: { model: "claude-sonnet-5-5" } } });
});

test("a step can allow every tool instead of a list", () => {
  const dispatch = vi.fn();
  const { rerender } = render(<Inspector graph={graph} selection={{ nodeId: "planner" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("switch", { name: "Allow every tool" }));
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "planner", patch: { config: { allTools: true } } });
  const everything: FlowGraph = { ...graph, nodes: graph.nodes.map((n) => (n.id === "planner" ? { ...n, data: { ...n.data, config: { allTools: true } } } : n)) };
  rerender(<Inspector graph={everything} selection={{ nodeId: "planner" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("Allowed tools")).toBeDisabled();
  expect(screen.getByText(/WebFetch/)).toBeInTheDocument();
});

import { fireEvent, render, screen } from "@testing-library/react";
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

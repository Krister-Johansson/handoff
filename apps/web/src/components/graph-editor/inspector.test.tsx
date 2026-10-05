import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    { id: "reviewer->planner", source: "reviewer", target: "planner", sourceHandle: "changes", targetHandle: "in", type: "handoff", data: { on: "passed", loop: false, priority: 0, port: "changes", input: "feedback" } },
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

test("a human gate can start the run's app for a person to try", () => {
  const dispatch = vi.fn();
  render(<Inspector graph={graph} selection={{ nodeId: "gate" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "try" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "gate", patch: { config: { mode: "try" } } });
  const tried = { ...graph, nodes: graph.nodes.map((n) => (n.id === "gate" ? { ...n, data: { ...n.data, config: { mode: "try" } } } : n)) };
  render(<Inspector graph={tried} selection={{ nodeId: "gate" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByText(/starts the run's app from .claude\/launch.json/)).toBeInTheDocument();
});

test("a demo runs for every change by default, or only for UI changes, and passes variables to the app", () => {
  const dispatch = vi.fn();
  const withDemo: FlowGraph = {
    ...graph,
    nodes: [...graph.nodes, { id: "demo", type: "handoff", position: { x: 900, y: 0 }, data: { nodeType: "demo", label: "Demo", isStart: false, config: {} } }],
  };
  render(<Inspector graph={withDemo} selection={{ nodeId: "demo" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("When to demo")).toHaveValue("always");
  fireEvent.change(screen.getByLabelText("When to demo"), { target: { value: "ui_changes" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "demo", patch: { config: { when: "ui_changes" } } });
  expect(screen.getByLabelText("Environment variables")).toBeInTheDocument();
  expect(screen.getByText(/the seed command and the app/)).toBeInTheDocument();
});

test("a merge node waits for a person to merge by default, or merges on its own in turn", () => {
  const dispatch = vi.fn();
  const withMerge: FlowGraph = {
    ...graph,
    nodes: [...graph.nodes, { id: "merge", type: "handoff", position: { x: 900, y: 0 }, data: { nodeType: "merge", label: "Merge", isStart: false, config: {} } }],
  };
  render(<Inspector graph={withMerge} selection={{ nodeId: "merge" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("When to merge")).toHaveValue("manual");
  fireEvent.change(screen.getByLabelText("When to merge"), { target: { value: "auto" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "merge", patch: { config: { mode: "auto" } } });
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

test("a code review node picks how thorough the review is", () => {
  const dispatch = vi.fn();
  const review: FlowGraph = { ...graph, nodes: [...graph.nodes, { id: "review", type: "handoff", position: { x: 0, y: 0 }, data: { nodeType: "code_review", label: "Code review", isStart: false, config: {} } }] };
  render(<Inspector graph={review} selection={{ nodeId: "review" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("Review level")).toHaveValue("high");
  fireEvent.change(screen.getByLabelText("Review level"), { target: { value: "max" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "review", patch: { config: { level: "max" } } });
});

test("a pull request node waits for review bots or people, and sends their comments back", () => {
  const dispatch = vi.fn();
  const pr = (config: Record<string, unknown>): FlowGraph => ({ ...graph, nodes: [...graph.nodes, { id: "pr", type: "handoff", position: { x: 0, y: 0 }, data: { nodeType: "pr", label: "Pull request", isStart: false, config } }] });
  const { rerender } = render(<Inspector graph={pr({})} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add CodeRabbit" }));
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { waitForReviewers: ["coderabbitai[bot]"] } } });

  rerender(<Inspector graph={pr({ waitForReviewers: ["coderabbitai[bot]"] })} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByRole("list", { name: "Reviewers to wait for" })).toHaveTextContent("coderabbitai[bot]");
  expect(screen.getByRole("switch", { name: "Send review comments back to the coder" })).toBeChecked();
  const login = screen.getByLabelText("Reviewer login");
  fireEvent.change(login, { target: { value: "octocat" } });
  fireEvent.keyDown(login, { key: "Enter" });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { waitForReviewers: ["coderabbitai[bot]", "octocat"] } } });
  fireEvent.change(screen.getByLabelText("Stop waiting after (minutes)"), { target: { value: "45" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewTimeoutMinutes: 45 } } });
});

test("a pull request node can ask a reviewer that has not started with a comment", () => {
  const dispatch = vi.fn();
  const pr = (config: Record<string, unknown>): FlowGraph => ({ ...graph, nodes: [...graph.nodes, { id: "pr", type: "handoff", position: { x: 0, y: 0 }, data: { nodeType: "pr", label: "Pull request", isStart: false, config } }] });
  const waiting = { waitForReviewers: ["octocat", "coderabbitai[bot]"] };
  const { rerender } = render(<Inspector graph={pr(waiting)} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  const ask = screen.getByRole("switch", { name: "Ask a reviewer that has not started" });
  expect(ask).not.toBeChecked();
  expect(screen.queryByLabelText("Comment")).not.toBeInTheDocument();
  fireEvent.click(ask);
  // CodeRabbit is asked by default, with its own command.
  const request = { reviewer: "coderabbitai[bot]", comment: "@coderabbitai review", afterMinutes: 2 };
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewRequest: request } } });

  rerender(<Inspector graph={pr({ ...waiting, reviewRequest: request })} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByRole("switch", { name: "Ask a reviewer that has not started" })).toBeChecked();
  expect(screen.getByLabelText("Reviewer to ask")).toHaveValue("coderabbitai[bot]");
  const comment = screen.getByLabelText("Comment");
  expect(comment).toHaveValue("@coderabbitai review");
  fireEvent.change(comment, { target: { value: "@coderabbitai full review" } });
  fireEvent.blur(comment);
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewRequest: { ...request, comment: "@coderabbitai full review" } } } });
  fireEvent.change(screen.getByLabelText("Ask after (minutes)"), { target: { value: "5" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewRequest: { ...request, afterMinutes: 5 } } } });
  fireEvent.change(screen.getByLabelText("Reviewer to ask"), { target: { value: "octocat" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewRequest: { ...request, reviewer: "octocat", comment: "@octocat review" } } } });

  fireEvent.click(screen.getByRole("switch", { name: "Ask a reviewer that has not started" }));
  expect(dispatch).toHaveBeenLastCalledWith({ type: "replaceNodeConfig", id: "pr", config: waiting });
});

const prGraph = (config: Record<string, unknown>): FlowGraph => ({ ...graph, nodes: [...graph.nodes, { id: "pr", type: "handoff", position: { x: 0, y: 0 }, data: { nodeType: "pr", label: "Pull request", isStart: false, config } }] });

test("turning on Reply to review comments turns on Send review comments back", () => {
  const dispatch = vi.fn();
  const { rerender } = render(<Inspector graph={prGraph({})} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  const group = within(screen.getByRole("group", { name: "Answer review comments" }));
  expect(group.queryByRole("switch", { name: "Resolve after the reviewer's next review" })).not.toBeInTheDocument();
  fireEvent.click(group.getByRole("switch", { name: "Reply to review comments" }));
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { sendReviewComments: true, reviewThreads: { reply: true } } } });

  const on = { sendReviewComments: true, reviewThreads: { reply: true } };
  rerender(<Inspector graph={prGraph(on)} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  // Send back stays on while replies are on.
  expect(screen.getByRole("switch", { name: "Send review comments back to the coder" })).toBeDisabled();
  expect(screen.getByText("Stays on while Reply to review comments is on.")).toBeInTheDocument();
  const settings = within(screen.getByRole("group", { name: "Answer review comments" }));
  expect(settings.getByRole("switch", { name: "Resolve after the reviewer's next review" })).toBeChecked();
  expect(settings.getByRole("switch", { name: "Return without tests when only answers changed" })).toBeChecked();
  const summary = settings.getByRole("switch", { name: "Read CodeRabbit's summary comment" });
  expect(summary).not.toBeChecked();
  fireEvent.click(summary);
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewThreads: { reply: true, summary: "coderabbitai" } } } });
  fireEvent.click(settings.getByRole("switch", { name: "Resolve after the reviewer's next review" }));
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewThreads: { reply: true, resolveAfterReview: false } } } });
  fireEvent.change(settings.getByLabelText("People (hours)"), { target: { value: "8" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewThreads: { reply: true, personWaitHours: 8 } } } });
  fireEvent.change(settings.getByLabelText("Comments per round"), { target: { value: "10" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewThreads: { reply: true, maxPerRound: 10 } } } });
  // A bot's next review is waited for as long as the review time limit, which shows with replies on.
  expect(settings.getByText(/Bots: as long as Stop waiting after \(minutes\)/)).toBeInTheDocument();
  expect(screen.getByLabelText("Stop waiting after (minutes)")).toBeInTheDocument();
  expect(settings.queryByLabelText(/Bots/)).not.toBeInTheDocument();

  fireEvent.click(settings.getByRole("switch", { name: "Reply to review comments" }));
  expect(dispatch).toHaveBeenLastCalledWith({ type: "updateNode", id: "pr", patch: { config: { reviewThreads: { reply: false } } } });
});

test("a PR node that sends comments back without replies shows the hint, and its button turns replies on", () => {
  const dispatch = vi.fn();
  const { rerender } = render(<Inspector graph={prGraph({ waitForReviewers: ["coderabbitai[bot]"] })} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByText(/Review comments go to the coder, but nobody answers them on GitHub/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Turn on replies" }));
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { sendReviewComments: true, reviewThreads: { reply: true } } } });

  rerender(<Inspector graph={prGraph({ waitForReviewers: ["coderabbitai[bot]"], sendReviewComments: false })} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.queryByText(/nobody answers them on GitHub/)).not.toBeInTheDocument();
  rerender(<Inspector graph={prGraph({ sendReviewComments: true, reviewThreads: { reply: true } })} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.queryByText(/nobody answers them on GitHub/)).not.toBeInTheDocument();
});

test("a pull request node says how long to wait for CI to start on a repository that may have none", () => {
  const dispatch = vi.fn();
  const pr: FlowGraph = { ...graph, nodes: [...graph.nodes, { id: "pr", type: "handoff", position: { x: 0, y: 0 }, data: { nodeType: "pr", label: "Pull request", isStart: false, config: {} } }] };
  render(<Inspector graph={pr} selection={{ nodeId: "pr" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Go on if no check starts within (minutes)"), { target: { value: "5" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "pr", patch: { config: { noChecksAfterMinutes: 5 } } });
});

test("Start says what starts the run, and with a Start no other node can be made the start", () => {
  const withStart: FlowGraph = {
    ...graph,
    attributes: { startNode: "start" },
    nodes: [{ id: "start", type: "handoff", position: { x: 0, y: 0 }, data: { nodeType: "start", label: "Start", isStart: true, config: { trigger: "run" } } }, ...graph.nodes.map((n) => ({ ...n, data: { ...n.data, isStart: false } }))],
  };
  const { rerender } = render(<Inspector graph={withStart} selection={{ nodeId: "start" }} library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("Trigger")).toHaveValue("run");
  expect(screen.getByText(/press Run or start a run for issues/i)).toBeInTheDocument();
  rerender(<Inspector graph={withStart} selection={{ nodeId: "planner" }} library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Make this the start node" })).not.toBeInTheDocument();
});

test("a node lists the edges that reach it and leave it, with each loop's budget", () => {
  const linked: FlowGraph = {
    ...graph,
    edges: [
      ...graph.edges,
      { id: "planner->reviewer", source: "planner", target: "reviewer", sourceHandle: "passed", targetHandle: "in", type: "handoff", data: { on: "passed", loop: false, priority: 0, port: "passed", input: "in" } },
    ],
  };
  render(<Inspector graph={linked} selection={{ nodeId: "planner" }} library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  const items = within(screen.getByRole("list", { name: "Edges" })).getAllByRole("listitem");
  expect(items.map((li) => li.textContent)).toEqual(["feedback←reviewer.changesmax 3", "passed→reviewer"]);
});

test("a node that two edges reach asks whether to wait for every edge or go on at the first", () => {
  const edge = (source: string): FlowGraph["edges"][number] => ({
    id: `${source}->gate`,
    source,
    target: "gate",
    sourceHandle: "approve",
    targetHandle: "in",
    type: "handoff",
    data: { on: "passed", loop: false, priority: 0, port: "approve", input: "in" },
  });
  const joined: FlowGraph = { ...graph, edges: [...graph.edges, edge("reviewer"), edge("planner")] };
  const dispatch = vi.fn();
  render(<Inspector graph={joined} selection={{ nodeId: "gate" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.getByLabelText("Join")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Join"), { target: { value: "any" } });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "gate", patch: { config: { join: "any" } } });
  cleanup();
  // The reviewer's feedback edge into the planner loops back, so the planner has nothing to join.
  render(<Inspector graph={joined} selection={{ nodeId: "planner" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  expect(screen.queryByLabelText("Join")).not.toBeInTheDocument();
});

const withNode = (id: string, nodeType: string, data: Partial<FlowGraph["nodes"][number]["data"]> = {}): FlowGraph => ({
  ...graph,
  nodes: [...graph.nodes, { id, type: "handoff", position: { x: 0, y: 0 }, data: { nodeType, label: id, isStart: false, config: {}, ...data } }],
});

test("a merge node says it is ready to merge, when it waits for you and when it fails, and stays quiet about merging until turned on", () => {
  const dispatch = vi.fn();
  render(<Inspector graph={withNode("merge", "merge")} selection={{ nodeId: "merge" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  const section = screen.getByRole("group", { name: "Notifications" });
  expect(within(section).getAllByRole("switch").map((s) => [s.getAttribute("aria-label") ?? s.id, (s as HTMLButtonElement).getAttribute("aria-checked")])).toEqual([
    ["notify-ready", "true"],
    ["notify-input", "true"],
    ["notify-merged", "false"],
    ["notify-failed", "true"],
  ]);
  fireEvent.click(within(section).getByRole("switch", { name: "Merged" }));
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "merge", patch: { notify: { merged: true } } });
});

test("Start stays quiet about the run starting until turned on", () => {
  render(<Inspector graph={withNode("start", "start")} selection={{ nodeId: "start" }} library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.getByRole("switch", { name: "Run started" })).not.toBeChecked();
});

test("Finish's earlier notify switch shows as Run finished, and changing it moves it into the node's notifications", () => {
  const dispatch = vi.fn();
  render(<Inspector graph={withNode("finish", "finish", { config: { notify: false } })} selection={{ nodeId: "finish" }} library={library} dispatch={dispatch} onSelect={vi.fn()} />);
  const finished = screen.getByRole("switch", { name: "Run finished" });
  expect(finished).not.toBeChecked();
  fireEvent.click(finished);
  expect(dispatch).toHaveBeenCalledWith({ type: "replaceNodeConfig", id: "finish", config: {} });
  expect(dispatch).toHaveBeenCalledWith({ type: "updateNode", id: "finish", patch: { notify: { finished: true } } });
  expect(screen.queryByText("Notify when done")).not.toBeInTheDocument();
});

test("a locked graph's edge and node cannot be deleted from the inspector", () => {
  render(<Inspector graph={graph} selection={{ edgeId: "reviewer->planner" }} locked library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Delete edge" })).toBeDisabled();
  cleanup();
  render(<Inspector graph={graph} selection={{ nodeId: "reviewer" }} locked library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Delete node" })).toBeDisabled();
});

test("with nothing selected the inspector draws nothing, locked or unlocked", () => {
  const { container, rerender } = render(<Inspector graph={graph} selection={{}} locked library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<Inspector graph={graph} selection={{}} library={library} dispatch={vi.fn()} onSelect={vi.fn()} />);
  expect(container).toBeEmptyDOMElement();
});

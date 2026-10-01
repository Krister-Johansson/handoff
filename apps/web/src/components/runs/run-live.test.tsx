import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RunLive } from "./run-live";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/inbox/actions", () => ({ answerAction: vi.fn(), cancelAction: vi.fn(), repairAction: vi.fn() }));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {}
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

const detail = (status: string, plan: string) => ({
  id: "e1",
  nodeKey: "planner",
  nodeType: "planner",
  attempt: 1,
  status,
  output: status === "passed" ? { plan, steps: [], ownedPaths: [] } : null,
  checks: null,
  error: null,
  trigger: { kind: "start" },
  costUsd: null,
  startedAt: null,
  finishedAt: null,
  repairNote: null,
});

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  fetchMock = vi.fn(async () => new Response(JSON.stringify(detail("passed", "Add a module."))));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const executions = [{ id: "e1", nodeKey: "planner", attempt: 1, status: "passed", costUsd: null, durationMs: null }];
const common = { projectId: "p1", runId: "r1", initialEvents: [], labels: { planner: "Plan", coder: "Code" }, prNumber: null, questions: [] };

test("selecting a step opens what it produced", async () => {
  render(<RunLive {...common} initialStatus="running" initialExecutions={executions} />);
  fireEvent.click(screen.getByRole("button", { name: /Plan/ }));
  expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/executions/e1", expect.anything());
  expect(await screen.findByText("Add a module.")).toBeInTheDocument();
});

test("a node pops out of the drawer into a large window with details and activity side by side", async () => {
  render(<RunLive {...common} initialStatus="running" initialExecutions={executions} />);
  fireEvent.click(screen.getByRole("button", { name: /Plan/ }));
  await screen.findByText("Add a module.");
  fireEvent.click(screen.getByRole("button", { name: "Pop out" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Add a module.");
  expect(screen.queryByRole("link", { name: "Open on its own page" })).not.toBeInTheDocument();
});

test("an open execution reloads when its status changes", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(detail("running", ""))));
  render(<RunLive {...common} initialStatus="running" initialExecutions={[{ ...executions[0]!, status: "running" }]} />);
  fireEvent.click(screen.getByRole("button", { name: /Plan/ }));
  // The drawer also loads the agent's activity; count only the loads of the execution itself.
  const detailLoads = () => fetchMock.mock.calls.filter(([url]) => url === "/api/runs/r1/executions/e1").length;
  await waitFor(() => expect(detailLoads()).toBe(1));
  act(() =>
    FakeEventSource.instances[0]!.emit({ seq: 1, type: "node.passed", payload: { nodeKey: "planner", attempt: 1 }, nodeExecutionId: "e1", createdAt: "2026-09-30T10:00:00Z" }),
  );
  expect(await screen.findByText("Add a module.")).toBeInTheDocument();
  expect(detailLoads()).toBe(2);
});

test("the page refreshes once when the run finishes, so the header shows the final state", () => {
  render(<RunLive {...common} initialStatus="running" initialExecutions={executions} />);
  expect(refresh).not.toHaveBeenCalled();
  act(() => FakeEventSource.instances[0]!.emit({ seq: 1, type: "run.succeeded", payload: {}, nodeExecutionId: null, createdAt: "2026-09-30T10:00:00Z" }));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("steps show their outcome, and a passed event brings the next step's summary live", () => {
  render(
    <RunLive
      {...common}
      initialStatus="running"
      initialExecutions={[
        { ...executions[0]!, summary: "Strip apostrophes. 2 steps" },
        { id: "e2", nodeKey: "coder", attempt: 1, status: "running", costUsd: null, durationMs: null },
      ]}
    />,
  );
  expect(screen.getByText("Strip apostrophes. 2 steps")).toBeInTheDocument();
  expect(screen.getByText("Code is working")).toBeInTheDocument();
  act(() =>
    FakeEventSource.instances[0]!.emit({
      seq: 1,
      type: "node.passed",
      payload: { nodeKey: "coder", attempt: 1, summary: "Removed apostrophes. 2 files changed", durationMs: 19_000 },
      nodeExecutionId: "e2",
      createdAt: "2026-09-30T10:00:00Z",
    }),
  );
  expect(screen.getByText("Removed apostrophes. 2 files changed")).toBeInTheDocument();
  expect(screen.getByText("19s")).toBeInTheDocument();
});

test("a failed step shows its error", () => {
  render(<RunLive {...common} initialStatus="failed" initialExecutions={[{ ...executions[0]!, status: "failed", error: "cli_error: claude exited" }]} />);
  expect(screen.getAllByText(/cli_error: claude exited/).length).toBeGreaterThan(0);
});

test("the banner learns the PR number from the stream while the PR node waits", () => {
  render(<RunLive {...common} labels={{ pr: "Pull request" }} initialStatus="running" initialExecutions={[{ id: "e3", nodeKey: "pr", attempt: 1, status: "running", costUsd: null, durationMs: null }]} />);
  act(() => {
    FakeEventSource.instances[0]!.emit({ seq: 1, type: "github.pr", payload: { number: 14, ci: "pending" }, nodeExecutionId: "e3", createdAt: "2026-09-30T10:00:00Z" });
    FakeEventSource.instances[0]!.emit({ seq: 2, type: "node.waiting", payload: { nodeKey: "pr", attempt: 1 }, nodeExecutionId: "e3", createdAt: "2026-09-30T10:00:01Z" });
  });
  expect(screen.getByText("Waiting for CI and reviews on PR #14")).toBeInTheDocument();
});

test("a node whose result sent work back shows sent back instead of passed", () => {
  const graphDocument = {
    attributes: { startNode: "planner" },
    nodes: [
      { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
      { key: "reviewer", attributes: { type: "reviewer", x: 300, y: 0 } },
    ],
    edges: [
      { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done" } },
      { key: "reviewer->planner", source: "reviewer", target: "planner", attributes: { port: "changes" } },
    ],
  };
  render(
    <RunLive
      {...common}
      graphDocument={graphDocument}
      labels={{ planner: "Plan", reviewer: "Review" }}
      initialStatus="running"
      initialExecutions={[{ id: "e2", nodeKey: "reviewer", attempt: 1, status: "running", costUsd: null, durationMs: null }]}
    />,
  );
  act(() => FakeEventSource.instances[0]!.emit({ seq: 1, type: "node.passed", payload: { nodeKey: "reviewer", attempt: 1 }, nodeExecutionId: "e2", createdAt: "2026-10-01T10:00:00Z" }));
  act(() =>
    FakeEventSource.instances[0]!.emit({ seq: 2, type: "edge.taken", payload: { edgeKey: "reviewer->planner", from: "reviewer", to: "planner" }, nodeExecutionId: "e2", createdAt: "2026-10-01T10:00:00Z" }),
  );
  expect(screen.getAllByText("sent back").length).toBeGreaterThan(0);
});

const gate = { id: "e5", nodeKey: "gate", attempt: 1, status: "waiting", costUsd: null, durationMs: null };
const question = (review: boolean) => ({
  id: "q1",
  nodeExecutionId: "e5",
  question: "Review the plan from Planner",
  options: ["approve", "changes"],
  runId: "r1",
  projectId: "p1",
  task: "Add a module",
  nodeKey: "gate",
  projectName: "demo",
  reason: "approval",
  context: review ? { review: { from: "planner", kind: "plan", markdown: "Plan" } } : {},
});

test("a review waiting on a person puts the way to it in the banner", () => {
  render(<RunLive {...common} labels={{ gate: "Approve the plan" }} initialStatus="waiting" initialExecutions={[gate]} questions={[question(true)]} />);
  const banner = screen.getByRole("status");
  expect(banner).toHaveTextContent("Approve the plan waits for your review");
  expect(within(banner).getByRole("link", { name: "Open the review" })).toHaveAttribute("href", "/projects/p1/runs/r1/review/q1");
});

test("a gate that starts waiting while the page is open refreshes it, so its question arrives", () => {
  render(<RunLive {...common} initialStatus="running" initialExecutions={[{ ...gate, status: "running" }]} />);
  act(() => FakeEventSource.instances[0]!.emit({ seq: 1, type: "node.waiting", payload: { nodeKey: "gate", attempt: 1 }, nodeExecutionId: "e5", createdAt: "2026-10-01T10:00:00Z" }));
  expect(refresh).toHaveBeenCalled();
});

test("a waiting gate's drawer shows its question with the way to answer it", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...detail("waiting", ""), id: "e5", nodeKey: "gate", nodeType: "human_gate" })));
  const { rerender } = render(<RunLive {...common} labels={{ gate: "Approve the plan" }} initialStatus="waiting" initialExecutions={[gate]} questions={[question(true)]} />);
  fireEvent.click(screen.getByRole("button", { name: /Approve the plan/ }));
  const drawer = await screen.findByRole("dialog");
  expect(within(drawer).getByText("Review the plan from Planner")).toBeInTheDocument();
  expect(within(drawer).getByRole("link", { name: "Open the review" })).toHaveAttribute("href", "/projects/p1/runs/r1/review/q1");

  rerender(<RunLive {...common} labels={{ gate: "Approve the plan" }} initialStatus="waiting" initialExecutions={[gate]} questions={[question(false)]} />);
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "approve" })).toBeInTheDocument();
});

const loopGraph = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", x: 0, y: 0 } },
    { key: "reviewer", attributes: { type: "reviewer", x: 300, y: 0 } },
  ],
  edges: [
    { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done" } },
    { key: "reviewer->planner", source: "reviewer", target: "planner", attributes: { port: "changes" } },
  ],
};
const looped = { ...executions[0]!, attempt: 2, via: "reviewer->planner", durationMs: 111_000, costUsd: "0.39" };

test("a step that a loop edge sent back names that edge, and the open step is marked", () => {
  render(
    <RunLive
      {...common}
      graphDocument={loopGraph}
      labels={{ planner: "Plan", reviewer: "Review" }}
      initialStatus="running"
      initialExecutions={[looped, { id: "e8", nodeKey: "reviewer", attempt: 2, status: "running", costUsd: null, durationMs: null, via: "planner->reviewer" }]}
    />,
  );
  const step = screen.getByRole("button", { name: /Plan/ });
  expect(step).toHaveTextContent("attempt 2");
  expect(step).toHaveTextContent("via reviewer->planner");
  // A forward edge is the usual way on and goes unnamed in the list.
  expect(screen.getByRole("button", { name: /Review/ })).not.toHaveTextContent("via planner->reviewer");
  expect(step).not.toHaveAttribute("aria-current");
  fireEvent.click(step);
  expect(step).toHaveAttribute("aria-current", "step");
});

test("the drawer heads with the node, its attempt, status, the edge that started it, time and cost", async () => {
  render(<RunLive {...common} initialStatus="running" initialExecutions={[looped]} />);
  fireEvent.click(screen.getByRole("button", { name: /Plan/ }));
  const drawer = await screen.findByRole("dialog");
  const heading = within(drawer).getByRole("heading", { level: 2 });
  expect(heading).toHaveTextContent("Plan");
  expect(heading).toHaveTextContent("planner");
  expect(heading).toHaveTextContent("attempt 2");
  expect(within(drawer).getByText("after reviewer->planner")).toBeInTheDocument();
  expect(within(drawer).getByText("$0.39")).toBeInTheDocument();
  fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("the Events tab counts the run's events, live", () => {
  const initialEvents = [{ seq: 1, type: "run.started", payload: {}, nodeExecutionId: null, createdAt: "2026-10-01T10:00:00Z" }];
  render(<RunLive {...common} initialEvents={initialEvents} initialStatus="running" initialExecutions={executions} />);
  expect(screen.getByRole("tab", { name: /Events/ })).toHaveTextContent("Events1");
  act(() => FakeEventSource.instances[0]!.emit({ seq: 2, type: "node.claimed", payload: { nodeKey: "planner", attempt: 1 }, nodeExecutionId: "e1", createdAt: "2026-10-01T10:00:01Z" }));
  expect(screen.getByRole("tab", { name: /Events/ })).toHaveTextContent("Events2");
});

test("the event list says it is live while the run goes on, and not once it ended", () => {
  const { unmount } = render(<RunLive {...common} initialStatus="running" initialExecutions={executions} />);
  expect(screen.getByText("live")).toBeInTheDocument();
  unmount();
  render(<RunLive {...common} initialStatus="succeeded" initialExecutions={executions} />);
  expect(screen.queryByText("live")).not.toBeInTheDocument();
});

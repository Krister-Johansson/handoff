import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import type { AssistantPort } from "@/lib/assistant/port";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { RunLive } from "./run-live";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }), usePathname: () => "/projects/p1/runs/r1" }));
vi.mock("@/app/inbox/actions", () => ({ answerAction: vi.fn(), cancelAction: vi.fn(), repairAction: vi.fn() }));
const projectActions = vi.hoisted(() => ({ requestMergeAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/projects/actions", () => projectActions);

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

test("while a step waits on a permission request, the status says the run waits on permission and the line says what the step asks", () => {
  render(
    <RunLive
      {...common}
      initialStatus="running"
      initialExecutions={[...executions, { id: "e2", nodeKey: "coder", attempt: 1, status: "running", costUsd: null, durationMs: null }]}
      waitingOn={{ kind: "permission", nodeKey: "coder", since: new Date("2026-10-05T09:00:00Z"), action: "asks to run a command" }}
    />,
  );
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("waiting on permission");
  expect(status).toHaveTextContent("Code asks to run a command");
  act(() => FakeEventSource.instances[0]!.emit({ seq: 9, type: "run.cancelled", payload: {}, nodeExecutionId: null, createdAt: "2026-10-05T10:00:00Z" }));
  expect(screen.getByRole("status")).toHaveTextContent("cancelled");
  expect(screen.getByRole("status")).not.toHaveTextContent("waiting on permission");
});

test("once the step that asked for permission ends, the run no longer waits on permission", () => {
  render(
    <RunLive
      {...common}
      initialStatus="running"
      initialExecutions={[...executions, { id: "e2", nodeKey: "coder", attempt: 1, status: "running", costUsd: null, durationMs: null }]}
      waitingOn={{ kind: "permission", nodeKey: "coder", since: new Date("2026-10-05T09:00:00Z"), action: "asks to run a command" }}
    />,
  );
  act(() => FakeEventSource.instances[0]!.emit({ seq: 9, type: "node.passed", payload: { nodeKey: "coder", attempt: 1 }, nodeExecutionId: "e2", createdAt: "2026-10-05T10:00:00Z" }));
  expect(screen.getByRole("status")).toHaveTextContent("running");
  expect(screen.getByRole("status")).not.toHaveTextContent("waiting on permission");
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

test.each(["loop.resolved", "node.repair_requested"])("the badge leaves failed on %s, and the page refreshes its failed run's cards", (type) => {
  refresh.mockClear();
  render(<RunLive {...common} initialStatus="failed" initialExecutions={[{ ...executions[0]!, status: "failed" }]} />);
  expect(screen.getByRole("status")).toHaveTextContent("failed");
  act(() => FakeEventSource.instances[0]!.emit({ seq: 1, type, payload: { nodeKey: "planner" }, nodeExecutionId: "e1", createdAt: "2026-10-03T10:00:00Z" }));
  expect(screen.getByRole("status")).toHaveTextContent("running");
  expect(screen.getByRole("status")).not.toHaveTextContent("failed");
  expect(refresh).toHaveBeenCalled();
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

test("a review waiting on a person puts the way to it beside the run's status", () => {
  render(<RunLive {...common} labels={{ gate: "Approve the plan" }} initialStatus="waiting" initialExecutions={[gate]} questions={[question(true)]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Approve the plan waits for your review");
  expect(screen.getByRole("link", { name: "Open the review" })).toHaveAttribute("href", "/projects/p1/runs/r1/review/q1");
});

test("a gate that starts waiting while the page is open refreshes it, so its question arrives", () => {
  render(<RunLive {...common} initialStatus="running" initialExecutions={[{ ...gate, status: "running" }]} />);
  act(() => FakeEventSource.instances[0]!.emit({ seq: 1, type: "node.waiting", payload: { nodeKey: "gate", attempt: 1 }, nodeExecutionId: "e5", createdAt: "2026-10-01T10:00:00Z" }));
  expect(refresh).toHaveBeenCalled();
});

test("a page waiting for the run's worktree refreshes once on the first event a step sends from it", () => {
  refresh.mockClear();
  const cli = (seq: number) => ({ seq, type: "cli.assistant", payload: { text: "hi" }, nodeExecutionId: "e1", createdAt: "2026-10-05T14:06:00Z" });
  render(<RunLive {...common} initialStatus="queued" initialExecutions={executions} awaitsWorktree />);
  act(() => FakeEventSource.instances[0]!.emit({ seq: 1, type: "node.claimed", payload: { nodeKey: "planner" }, nodeExecutionId: "e1", createdAt: "2026-10-05T14:05:00Z" }));
  expect(refresh).not.toHaveBeenCalled();
  act(() => FakeEventSource.instances[0]!.emit(cli(2)));
  act(() => FakeEventSource.instances[0]!.emit(cli(3)));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("a page that already has the run's worktree does not refresh for a step's events", () => {
  refresh.mockClear();
  render(<RunLive {...common} initialStatus="running" initialExecutions={executions} />);
  act(() => FakeEventSource.instances[0]!.emit({ seq: 1, type: "cli.assistant", payload: { text: "hi" }, nodeExecutionId: "e1", createdAt: "2026-10-05T14:06:00Z" }));
  expect(refresh).not.toHaveBeenCalled();
});

test("a step that asks permission while the page is open refreshes it, so the request shows", () => {
  render(<RunLive {...common} initialStatus="running" initialExecutions={executions} />);
  refresh.mockClear();
  act(() =>
    FakeEventSource.instances[0]!.emit({ seq: 1, type: "permission.requested", payload: { id: "p1", toolName: "Bash", input: { command: "ls" } }, nodeExecutionId: "e1", createdAt: "2026-10-01T10:00:00Z" }),
  );
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

test("a Try it gate waiting on a person puts the way to it beside the run's status", () => {
  const tryIt = { ...question(false), context: { reason: "try", acceptance: ["A user can create a new task"] } };
  render(<RunLive {...common} labels={{ gate: "Try it" }} initialStatus="waiting" initialExecutions={[gate]} questions={[tryIt]} />);
  expect(screen.getByRole("link", { name: "Open Try it" })).toHaveAttribute("href", "/projects/p1/runs/r1/try/q1");
});

test("a run first in the merge queue can be merged beside its status", async () => {
  const merge = { id: "e9", nodeKey: "merge", attempt: 1, status: "waiting", costUsd: null, durationMs: null };
  render(<RunLive {...common} labels={{ merge: "Merge" }} initialStatus="waiting" initialExecutions={[merge]} queue={{ position: 1, requested: false, mode: "manual" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Ready to merge");
  fireEvent.click(screen.getByRole("button", { name: "Merge" }));
  await waitFor(() => expect(projectActions.requestMergeAction).toHaveBeenCalledWith({ runId: "r1", projectId: "p1" }));
});

test("a run further back in the queue has no merge button", () => {
  const merge = { id: "e9", nodeKey: "merge", attempt: 1, status: "waiting", costUsd: null, durationMs: null };
  render(<RunLive {...common} initialStatus="waiting" initialExecutions={[merge]} queue={{ position: 2, requested: false, mode: "manual" }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Ready to merge, 2nd in line");
  expect(screen.queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
});

test("what the run is doing now sits in the page header, beside the run's actions", () => {
  render(
    <RunLive
      {...common}
      labels={{ gate: "Approve the plan" }}
      initialStatus="waiting"
      initialExecutions={[gate]}
      questions={[question(true)]}
      header={{ crumbs: [{ label: "Projects", href: "/projects" }], title: "Add a module", meta: "master v12", actions: <button type="button">Cancel run</button> }}
    />,
  );
  const header = screen.getByRole("heading", { level: 1, name: "Add a module" }).closest("header")!;
  expect(within(header).getByRole("status")).toHaveTextContent("Approve the plan waits for your review");
  expect(within(header).getByRole("link", { name: "Open the review" })).toBeInTheDocument();
  expect(within(header).getByRole("button", { name: "Cancel run" })).toBeInTheDocument();
  expect(header).toHaveTextContent("master v12");
  expect(screen.getAllByRole("status")).toHaveLength(1);
});

function Grab({ onPort }: { onPort: (port: AssistantPort) => void }) {
  const port = useAssistant();
  useEffect(() => {
    onPort(port);
  }, [onPort, port]);
  return null;
}

/**
 * The run page inside the assistant, with a turn running so the test can call the page's tools as the
 * model would: `call` emits a ui_call and resolves with the page's answer.
 */
async function withAssistant(props: Omit<ComponentProps<typeof RunLive>, "projectId" | "runId" | "initialEvents" | "labels" | "prNumber" | "questions"> & Partial<ComponentProps<typeof RunLive>>) {
  const transport = new FakeAssistantTransport();
  let port: AssistantPort | undefined;
  const onPort = (p: AssistantPort) => (port = p);
  render(
    <AssistantProvider transport={transport} available>
      <Grab onPort={onPort} />
      <RunLive {...common} {...props} />
    </AssistantProvider>,
  );
  act(() => void port!.send("what is on this page"));
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  let next = 1;
  const call = async (name: string, args: unknown = {}) => {
    const requestId = `u${next++}`;
    act(() => transport.emit({ type: "ui_call", requestId, name, args }));
    await waitFor(() => expect(transport.uiReplies.find((r) => r.requestId === requestId)).toBeDefined());
    const { text, isError } = transport.uiReplies.find((r) => r.requestId === requestId)!;
    return { text, isError };
  };
  const whereAmI = async () => JSON.parse((await call("where_am_i")).text) as { page?: { kind: string; tools: { name: string }[]; state: { data: Record<string, unknown> } } };
  return { call, whereAmI, transport };
}

const selectedTab = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;

test("page_show_view switches to the graph and events views and where_am_i says which is shown", async () => {
  const { call, whereAmI } = await withAssistant({ initialStatus: "running", initialExecutions: executions });
  expect(selectedTab()).toBe("Steps");
  expect((await whereAmI()).page).toMatchObject({ kind: "run", state: { data: { view: "steps" } } });

  expect(await call("page_show_view", { view: "graph" })).toEqual({ text: "Showing the graph view.", isError: false });
  expect(selectedTab()).toBe("Graph");
  expect((await whereAmI()).page?.state.data).toMatchObject({ view: "graph" });

  expect(await call("page_show_view", { view: "events" })).toEqual({ text: "Showing the events view.", isError: false });
  expect(selectedTab()).toMatch(/^Events/);

  // A tab the person clicks is what where_am_i reports next.
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Steps" }));
  await waitFor(() => expect(selectedTab()).toBe("Steps"));
  expect((await whereAmI()).page?.state.data).toMatchObject({ view: "steps" });
});

test("where_am_i on the run page gives its ids, status, steps and open questions, and lists its five tools", async () => {
  const { whereAmI } = await withAssistant({ labels: { gate: "Approve the plan" }, initialStatus: "waiting", initialExecutions: [gate], questions: [question(false)] });
  const page = (await whereAmI()).page!;
  expect(page.tools.map((t) => t.name)).toEqual(["page_show_view", "page_open_step", "page_close_step", "page_pop_out", "page_filter_events"]);
  expect(page.state.data).toEqual({
    runId: "r1",
    projectId: "p1",
    status: "waiting",
    view: "steps",
    steps: [{ id: "e5", nodeKey: "gate", label: "Approve the plan", attempt: 1, status: "waiting" }],
    openStep: null,
    poppedOut: false,
    events: { node: null, cli: false },
    questions: [{ id: "q1", stepId: "e5", nodeKey: "gate", reason: "approval", question: "Review the plan from Planner", options: ["approve", "changes"] }],
  });
});

test("page_open_step opens the latest execution of a node key, and an attempt opens that one; a key that is not a step is refused with the keys", async () => {
  const steps = [
    { ...executions[0]!, id: "e1" },
    { ...looped, id: "e2" },
    { id: "e3", nodeKey: "reviewer", attempt: 1, status: "running", costUsd: null, durationMs: null },
  ];
  const { call, whereAmI } = await withAssistant({ labels: { planner: "Plan", reviewer: "Review" }, initialStatus: "running", initialExecutions: steps });
  const drawerHeading = () => within(screen.getByRole("dialog")).getByRole("heading", { level: 2 });

  expect(await call("page_open_step", { step: "planner" })).toEqual({ text: "Opened Plan (planner), attempt 2.", isError: false });
  expect(drawerHeading()).toHaveTextContent("attempt 2");
  expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/executions/e2", expect.anything());

  expect(await call("page_open_step", { step: "planner", attempt: 1 })).toEqual({ text: "Opened Plan (planner), attempt 1.", isError: false });
  await waitFor(() => expect(drawerHeading()).not.toHaveTextContent("attempt"));
  expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/executions/e1", expect.anything());

  // An execution id from where_am_i opens that execution.
  expect(await call("page_open_step", { step: "e3" })).toEqual({ text: "Opened Review (reviewer), attempt 1.", isError: false });
  expect(drawerHeading()).toHaveTextContent("Review");
  expect((await whereAmI()).page?.state.data).toMatchObject({ openStep: { id: "e3", nodeKey: "reviewer", attempt: 1 } });

  expect(await call("page_open_step", { step: "tester" })).toEqual({ text: "No step has the key or id tester. The steps are planner, reviewer.", isError: true });
  expect(await call("page_open_step", { step: "planner", attempt: 3 })).toEqual({ text: "planner has no attempt 3. Its attempts are 1, 2.", isError: true });
  expect(drawerHeading()).toHaveTextContent("Review");
});

test("page_close_step closes the drawer and page_pop_out needs an open step", async () => {
  const { call, whereAmI } = await withAssistant({ initialStatus: "running", initialExecutions: executions });
  expect(await call("page_pop_out", { open: true })).toEqual({ text: "No step is open. Open one with page_open_step first.", isError: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await call("page_open_step", { step: "planner" });
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Pop out" })).toBeInTheDocument();
  expect(await call("page_pop_out", { open: true })).toEqual({ text: "Popped out Plan (planner).", isError: false });
  // The large window has no Pop out button of its own.
  await waitFor(() => expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Pop out" })).not.toBeInTheDocument());
  expect((await whereAmI()).page?.state.data).toMatchObject({ openStep: { nodeKey: "planner" }, poppedOut: true });

  expect(await call("page_pop_out", { open: false })).toEqual({ text: "Put Plan (planner) back in the drawer.", isError: false });
  await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Pop out" })).toBeInTheDocument());

  await call("page_pop_out", { open: true });
  expect(await call("page_close_step")).toEqual({ text: "Closed Plan (planner).", isError: false });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect((await whereAmI()).page?.state.data).toMatchObject({ openStep: null, poppedOut: false });
  expect(await call("page_close_step")).toEqual({ text: "No step was open.", isError: false });
});

test("page_filter_events narrows the events to a node and shows the events view", async () => {
  const steps = [executions[0]!, { id: "e2", nodeKey: "coder", attempt: 1, status: "running", costUsd: null, durationMs: null }];
  const at = "2026-10-02T10:00:00Z";
  const initialEvents = [
    { seq: 1, type: "node.claimed", payload: { nodeKey: "planner", attempt: 1 }, nodeExecutionId: "e1", createdAt: at },
    { seq: 2, type: "node.failed", payload: { nodeKey: "coder", attempt: 1 }, nodeExecutionId: "e2", createdAt: at },
    { seq: 3, type: "cli.tool_use", payload: { name: "Edit" }, nodeExecutionId: "e2", createdAt: at },
  ];
  const { call, whereAmI } = await withAssistant({ initialStatus: "running", initialExecutions: steps, initialEvents });
  expect(screen.getByText("node.claimed")).toBeInTheDocument();
  expect(screen.queryByText("cli.tool_use")).not.toBeInTheDocument();

  expect(await call("page_filter_events", { node: "coder" })).toEqual({ text: "Showing the events of Code (coder).", isError: false });
  expect(selectedTab()).toMatch(/^Events/);
  expect(screen.getByRole("combobox", { name: "Node" })).toHaveValue("coder");
  expect(screen.getByText("node.failed")).toBeInTheDocument();
  expect(screen.queryByText("node.claimed")).not.toBeInTheDocument();
  expect((await whereAmI()).page?.state.data).toMatchObject({ view: "events", events: { node: "coder", cli: false } });

  // cli alone keeps the node; node null shows every node again.
  expect(await call("page_filter_events", { cli: true })).toEqual({ text: "Showing the events of Code (coder), with the Claude CLI's events.", isError: false });
  expect(screen.getByRole("switch", { name: "Claude CLI events" })).toBeChecked();
  expect(screen.getByText("cli.tool_use")).toBeInTheDocument();
  expect(await call("page_filter_events", { node: null })).toEqual({ text: "Showing the events of every node, with the Claude CLI's events.", isError: false });
  expect(screen.getByText("node.claimed")).toBeInTheDocument();

  expect(await call("page_filter_events", { node: "tester" })).toEqual({ text: "No step has the key tester. The steps are planner, coder.", isError: true });
  expect(screen.getByRole("combobox", { name: "Node" })).toHaveValue("");
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RunLive } from "./run-live";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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
const common = { runId: "r1", initialEvents: [], labels: { planner: "Plan", coder: "Code" }, prNumber: null, questions: 0 };

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

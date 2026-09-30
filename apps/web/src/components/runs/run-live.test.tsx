import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { RunLive } from "./run-live";

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

test("selecting an execution in the Nodes table opens what it produced", async () => {
  render(<RunLive runId="r1" initialStatus="running" initialExecutions={executions} initialEvents={[]} />);
  fireEvent.click(screen.getByRole("button", { name: /planner/ }));
  expect(fetchMock).toHaveBeenCalledWith("/api/runs/r1/executions/e1", expect.anything());
  expect(await screen.findByText("Add a module.")).toBeInTheDocument();
});

test("an open execution reloads when its status changes", async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(detail("running", ""))));
  render(<RunLive runId="r1" initialStatus="running" initialExecutions={[{ ...executions[0]!, status: "running" }]} initialEvents={[]} />);
  fireEvent.click(screen.getByRole("button", { name: /planner/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  act(() =>
    FakeEventSource.instances[0]!.emit({ seq: 1, type: "node.passed", payload: { nodeKey: "planner", attempt: 1 }, nodeExecutionId: "e1", createdAt: "2026-09-30T10:00:00Z" }),
  );
  expect(await screen.findByText("Add a module.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ExecutionView } from "./execution-view";

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

const detail = (status: string) => ({
  id: "e1",
  nodeKey: "coder",
  nodeType: "coder",
  attempt: 1,
  status,
  output: status === "passed" ? { status: "done", summary: "Scaffolded." } : null,
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
  fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/events") ? Response.json({ events: [] }) : Response.json(detail(fetchMock.mock.calls.length > 2 ? "passed" : "running")),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

test("an execution on its own page follows the run: new activity shows, and it reloads when the node finishes", async () => {
  render(<ExecutionView runId="r1" executionId="e1" initialStatus="running" />);
  expect(await screen.findByText("No activity yet.")).toBeInTheDocument();
  expect(FakeEventSource.instances[0]!.url).toBe("/api/runs/r1/events?after=0");
  act(() =>
    FakeEventSource.instances[0]!.emit({ seq: 5, type: "cli.assistant", payload: { message: { content: [{ type: "text", text: "Writing the scaffold." }] } }, nodeExecutionId: "e1", createdAt: "2026-10-01T10:00:00Z" }),
  );
  expect(await screen.findByText("Writing the scaffold.")).toBeInTheDocument();
  act(() => FakeEventSource.instances[0]!.emit({ seq: 6, type: "node.passed", payload: { nodeKey: "coder", attempt: 1 }, nodeExecutionId: "e1", createdAt: "2026-10-01T10:00:01Z" }));
  await waitFor(() => expect(screen.getByText("Scaffolded.")).toBeInTheDocument());
});

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EventStream } from "./event-stream";

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  listeners = new Map<string, (e: MessageEvent) => void>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, fn);
  }
  close() {
    this.closed = true;
  }
  emit(data: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

const event = (seq: number, type: string, payload: unknown = {}) => ({ seq, type, payload, nodeExecutionId: null, createdAt: "2026-09-30T10:00:00Z" });

test("event stream subscribes after the last initial event and renders new events as they arrive", () => {
  render(<EventStream runId="r1" initialEvents={[event(1, "run.created")]} />);
  expect(FakeEventSource.instances[0]?.url).toBe("/api/runs/r1/events?after=1");
  expect(screen.getByText("run.created")).toBeInTheDocument();
  act(() => FakeEventSource.instances[0]!.emit(event(2, "node.passed", { nodeKey: "planner", attempt: 1 })));
  expect(screen.getByText("node.passed")).toBeInTheDocument();
  expect(screen.getByText("planner, attempt 1")).toBeInTheDocument();
});

test("event stream ignores duplicates it has already shown", () => {
  render(<EventStream runId="r1" initialEvents={[event(1, "run.created")]} />);
  act(() => FakeEventSource.instances[0]!.emit(event(1, "run.created")));
  expect(screen.getAllByText("run.created")).toHaveLength(1);
});

test("event stream reports each new event to the parent", () => {
  const onEvent = vi.fn();
  render(<EventStream runId="r1" initialEvents={[]} onEvent={onEvent} />);
  act(() => FakeEventSource.instances[0]!.emit(event(1, "run.started")));
  expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "run.started" }));
});

test("the engine view hides Claude CLI events, and a node filter keeps that node's events", () => {
  const ev = (seq: number, type: string, nodeExecutionId: string | null) => ({ ...event(seq, type), nodeExecutionId });
  const initial = [ev(1, "run.created", null), ev(2, "node.claimed", "e1"), ev(3, "cli.assistant", "e1"), ev(4, "node.passed", "e1"), ev(5, "node.claimed", "e2")];
  const { rerender } = render(<EventStream runId="r1" initialEvents={initial} filter={{ showCli: false }} />);
  expect(screen.queryByText("cli.assistant")).not.toBeInTheDocument();
  expect(screen.getAllByText("node.claimed")).toHaveLength(2);
  rerender(<EventStream runId="r1" initialEvents={initial} filter={{ showCli: true, executionIds: new Set(["e1"]) }} />);
  expect(screen.getByText("cli.assistant")).toBeInTheDocument();
  expect(screen.getAllByText("node.claimed")).toHaveLength(1);
  expect(screen.queryByText("run.created")).not.toBeInTheDocument();
});

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

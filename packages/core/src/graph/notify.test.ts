import { expect, test } from "vitest";
import { compileGraph } from "./compile.ts";
import { notifies, notifyKindsOf, NotifyKindSchema, toneOf } from "./notify.ts";

test("each node type offers what it can notify about", () => {
  expect(notifyKindsOf("start")).toEqual(["started"]);
  expect(notifyKindsOf("finish")).toEqual(["finished"]);
  expect(notifyKindsOf("human_gate")).toEqual(["input", "failed"]);
  expect(notifyKindsOf("merge")).toEqual(["ready", "input", "merged", "failed"]);
  expect(notifyKindsOf("coder")).toEqual(["permission", "failed"]);
  expect(notifyKindsOf("tester")).toEqual(["failed"]);
});

test("by default a node notifies about what needs a person and how the run ended, not about starts or merges", () => {
  const node = { notify: undefined };
  expect(["started", "finished", "failed", "input", "permission", "ready", "merged"].map((k) => [k, notifies(node, k as never)])).toEqual([
    ["started", false],
    ["finished", true],
    ["failed", true],
    ["input", true],
    ["permission", true],
    ["ready", true],
    ["merged", false],
  ]);
});

test("a node's own setting wins over the default", () => {
  expect(notifies({ notify: { merged: true, ready: false } }, "merged")).toBe(true);
  expect(notifies({ notify: { merged: true, ready: false } }, "ready")).toBe(false);
});

test("a Finish node's earlier notify switch still decides whether the run's end is news", () => {
  expect(notifies({ config: { notify: false } }, "finished")).toBe(false);
  expect(notifies({ config: { notify: false }, notify: { finished: true } }, "finished")).toBe(true);
});

test("compiling keeps a node's notification settings", () => {
  const result = compileGraph({
    attributes: { startNode: "start" },
    nodes: [
      { key: "start", attributes: { type: "start", notify: { started: true } } },
      { key: "finish", attributes: { type: "finish" } },
    ],
    edges: [{ key: "a", source: "start", target: "finish" }],
  });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  expect(result.graph.node("start").notify).toEqual({ started: true });
  expect(result.graph.node("finish").notify).toBeUndefined();
});

test("each kind a node can notify about has the tone its notification is shown with", () => {
  expect(NotifyKindSchema.options.map((kind) => [kind, toneOf(kind)])).toEqual([
    ["started", "neutral"],
    ["finished", "success"],
    ["failed", "danger"],
    ["input", "attention"],
    ["permission", "attention"],
    ["ready", "attention"],
    ["merged", "success"],
  ]);
});

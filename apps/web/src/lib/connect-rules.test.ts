import { expect, test } from "vitest";
import { canConnect } from "./connect-rules";

test("an output connects to another node's input; onto a pair that has an edge, it re-wires that edge", () => {
  expect(canConnect({ node: "review", type: "source" }, { node: "planner", type: "target" })).toBe(true);
  expect(canConnect({ node: "planner", type: "source" }, { node: "review", type: "target" })).toBe(true);
  expect(canConnect({ node: "planner", type: "source" }, { node: "gate", type: "target" })).toBe(true);
});

test("never an output into an output, an input into an input, or a node into itself", () => {
  expect(canConnect({ node: "planner", type: "source" }, { node: "gate", type: "source" })).toBe(false);
  expect(canConnect({ node: "planner", type: "target" }, { node: "gate", type: "target" })).toBe(false);
  expect(canConnect({ node: "planner", type: "source" }, { node: "planner", type: "target" })).toBe(false);
});

test("dragging back from an input finds the outputs that can feed it", () => {
  expect(canConnect({ node: "review", type: "target" }, { node: "gate", type: "source" })).toBe(true);
  expect(canConnect({ node: "review", type: "target" }, { node: "review", type: "source" })).toBe(false);
});

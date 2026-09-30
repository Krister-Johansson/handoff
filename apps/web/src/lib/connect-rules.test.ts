import { expect, test } from "vitest";
import { canConnect } from "./connect-rules";

const edges = [{ source: "planner", target: "review" }];

test("an output connects to another node's input, once per pair", () => {
  expect(canConnect({ node: "review", type: "source" }, { node: "planner", type: "target" }, edges)).toBe(true);
  expect(canConnect({ node: "planner", type: "source" }, { node: "review", type: "target" }, edges)).toBe(false);
  expect(canConnect({ node: "planner", type: "source" }, { node: "gate", type: "target" }, edges)).toBe(true);
});

test("never an output into an output, an input into an input, or a node into itself", () => {
  expect(canConnect({ node: "planner", type: "source" }, { node: "gate", type: "source" }, edges)).toBe(false);
  expect(canConnect({ node: "planner", type: "target" }, { node: "gate", type: "target" }, edges)).toBe(false);
  expect(canConnect({ node: "planner", type: "source" }, { node: "planner", type: "target" }, edges)).toBe(false);
});

test("dragging back from an input finds the outputs that can feed it", () => {
  expect(canConnect({ node: "review", type: "target" }, { node: "gate", type: "source" }, edges)).toBe(true);
  expect(canConnect({ node: "review", type: "target" }, { node: "planner", type: "source" }, edges)).toBe(false);
});

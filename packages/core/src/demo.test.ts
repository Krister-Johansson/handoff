import { expect, test } from "vitest";
import { renderContextPacket } from "./context/render.ts";
import { nodeCatalog } from "./graph/catalog.ts";
import { portsOf } from "./graph/ports.ts";
import { contractRegistry } from "./schema/contracts.ts";

test("a Demo node is a Claude step that reads the repository and drives a browser, and goes on when done", () => {
  expect(nodeCatalog.demo).toEqual({ executorKind: "cli", contract: "demo_output", allowedTools: ["Read", "Glob", "Grep", "mcp__playwright"] });
  expect(portsOf("demo", {}).outputs.map((p) => [p.id, p.kind])).toEqual([["done", "continue"]]);
});

test("a demo's output is its screenshots, each with a caption and whether its criterion works", () => {
  const parsed = contractRegistry.demo_output.parse({
    summary: "Created a task and reloaded.",
    shots: [{ file: "page-1.png", caption: "The new task in the list", criterion: "A user can create a new task", works: true }],
  });
  expect(parsed.shots[0]).toMatchObject({ file: "page-1.png", works: true });
  expect(() => contractRegistry.demo_output.parse({ summary: "x", shots: [{ caption: "no file", works: true }] })).toThrow();
});

test("a step given the running app is told where it runs and how to take screenshots", () => {
  const md = renderContextPacket({
    task: "t",
    nodeKey: "demo",
    stateSlice: {},
    repoPaths: [],
    constraints: { ownedPaths: [], allowedTools: [], maxTurns: 10 },
    outputContract: "demo_output",
    app: { url: "http://localhost:41000" },
  });
  expect(md).toContain("# The running app");
  expect(md).toContain("http://localhost:41000");
  expect(md).toContain("browser_take_screenshot");
});

import { expect, test } from "vitest";
import { parsePlanView } from "./project-tab";

test("parsePlanView opens the plan mode's view unless the tree or the board is asked for", () => {
  expect(parsePlanView({}, "flow")).toBe("flow");
  expect(parsePlanView({}, "timeline")).toBe("timeline");
  expect(parsePlanView({ view: "board" }, "flow")).toBe("board");
  expect(parsePlanView({ view: "tree" }, "flow")).toBe("tree");
  expect(parsePlanView({ view: ["board", "tree"] }, "flow")).toBe("flow");
  expect(parsePlanView({ view: "gantt" }, "timeline")).toBe("timeline");
});

test("view=timeline opens Flow in a Flow project", () => {
  expect(parsePlanView({ view: "timeline" }, "flow")).toBe("flow");
  expect(parsePlanView({ view: "flow" }, "flow")).toBe("flow");
  expect(parsePlanView({ view: "board" }, "flow")).toBe("board");
  // An old Flow link in a Timeline project opens the Timeline.
  expect(parsePlanView({ view: "flow" }, "timeline")).toBe("timeline");
  expect(parsePlanView({ view: "timeline" }, "timeline")).toBe("timeline");
});

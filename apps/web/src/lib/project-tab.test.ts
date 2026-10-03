import { expect, test } from "vitest";
import { parsePlanView } from "./project-tab";

test("parsePlanView defaults to the tree and accepts the board", () => {
  expect(parsePlanView({})).toBe("tree");
  expect(parsePlanView({ view: "board" })).toBe("board");
  expect(parsePlanView({ view: "tree" })).toBe("tree");
  expect(parsePlanView({ view: ["board", "tree"] })).toBe("tree");
  expect(parsePlanView({ view: "gantt" })).toBe("tree");
});

test("view=timeline opens Flow in a Flow project", () => {
  expect(parsePlanView({ view: "timeline" }, "flow")).toBe("flow");
  expect(parsePlanView({ view: "flow" }, "flow")).toBe("flow");
  expect(parsePlanView({ view: "board" }, "flow")).toBe("board");
  expect(parsePlanView({}, "flow")).toBe("tree");
  // An old Flow link in a Timeline project opens the Timeline.
  expect(parsePlanView({ view: "flow" }, "timeline")).toBe("timeline");
  expect(parsePlanView({ view: "timeline" }, "timeline")).toBe("timeline");
});

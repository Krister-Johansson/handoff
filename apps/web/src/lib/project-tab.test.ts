import { expect, test } from "vitest";
import { parsePlanView } from "./project-tab";

test("parsePlanView defaults to the tree and accepts the board", () => {
  expect(parsePlanView({})).toBe("tree");
  expect(parsePlanView({ view: "board" })).toBe("board");
  expect(parsePlanView({ view: "tree" })).toBe("tree");
  expect(parsePlanView({ view: ["board", "tree"] })).toBe("tree");
  expect(parsePlanView({ view: "gantt" })).toBe("tree");
});

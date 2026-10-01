import { expect, test } from "vitest";
import { parseDependsOn } from "./depends-on";

test("the issues a body says it depends on are read from its Depends on line", () => {
  expect(parseDependsOn("Intro.\n\nDepends on: #5 (F05), #6 (F06)\n\n**Acceptance:** green.")).toEqual([5, 6]);
  expect(parseDependsOn("**Depends on:** #3")).toEqual([3]);
  expect(parseDependsOn("depends on #12 and #14")).toEqual([12, 14]);
  expect(parseDependsOn("Depends on: none")).toEqual([]);
  expect(parseDependsOn("Fixes #3. Nothing depends on this.")).toEqual([]);
  expect(parseDependsOn("")).toEqual([]);
});

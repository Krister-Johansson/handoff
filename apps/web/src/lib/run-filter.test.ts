import { expect, test } from "vitest";
import { parseRunFilter, runFilterHref } from "./run-filter";

test("parseRunFilter reads a known status and a project name", () => {
  expect(parseRunFilter({ status: "failed", project: "sandbox" })).toEqual({ status: "failed", project: "sandbox" });
});

test("parseRunFilter ignores unknown statuses, arrays and empty values", () => {
  expect(parseRunFilter({ status: "bogus", project: "" })).toEqual({});
  expect(parseRunFilter({ status: ["failed", "active"] })).toEqual({});
});

test("runFilterHref keeps the other filter and drops empty ones", () => {
  expect(runFilterHref({ project: "sandbox" }, { status: "active" })).toBe("/runs?status=active&project=sandbox");
  expect(runFilterHref({ status: "failed", project: "sandbox" }, { project: undefined })).toBe("/runs?status=failed");
  expect(runFilterHref({ status: "failed" }, { status: undefined })).toBe("/runs");
});

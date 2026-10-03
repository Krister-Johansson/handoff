import { expect, test } from "vitest";
import { parseRunsFilter, RUNS_FILTERS } from "./run-status-filter";

test("parseRunsFilter reads active, waiting, failed and done, and lists every run otherwise", () => {
  expect(parseRunsFilter({})).toBeUndefined();
  expect(parseRunsFilter({ status: "active" })).toBe("active");
  expect(parseRunsFilter({ status: "waiting" })).toBe("waiting");
  expect(parseRunsFilter({ status: "failed" })).toBe("failed");
  expect(parseRunsFilter({ status: "done" })).toBe("done");
  expect(parseRunsFilter({ status: "cancelled" })).toBeUndefined();
  expect(parseRunsFilter({ status: ["failed", "done"] })).toBeUndefined();
});

test("Active is queued and running, Waiting is waiting, Failed is failed, Done is succeeded and cancelled", () => {
  expect(RUNS_FILTERS.map((f) => [f.label, f.statuses])).toEqual([
    ["Active", ["queued", "running"]],
    ["Waiting", ["waiting"]],
    ["Failed", ["failed"]],
    ["Done", ["succeeded", "cancelled"]],
  ]);
});

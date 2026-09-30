import { expect, test } from "vitest";
import { formatCost, formatDuration } from "./format";

test("formatDuration uses the largest sensible unit", () => {
  expect(formatDuration(850)).toBe("0.9s");
  expect(formatDuration(12_400)).toBe("12s");
  expect(formatDuration(125_000)).toBe("2m 5s");
  expect(formatDuration(3_725_000)).toBe("1h 2m");
  expect(formatDuration(null)).toBe("");
});

test("formatCost shows two decimals and marks the value as an estimate", () => {
  expect(formatCost(0.1297)).toBe("$0.13");
  expect(formatCost(0.004)).toBe("<$0.01");
  expect(formatCost(null)).toBe("");
});

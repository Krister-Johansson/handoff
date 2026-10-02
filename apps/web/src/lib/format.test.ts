import { expect, test } from "vitest";
import { formatAgo, formatCost, formatDuration, formatSince } from "./format";

test("formatSince says briefly how long something has gone on, in the largest whole unit", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);
  expect(formatSince(ago(20), now)).toBe("under a minute");
  expect(formatSince(ago(11 * 60 + 30), now)).toBe("11 min");
  expect(formatSince(ago(3 * 3600 + 120), now)).toBe("3 h");
  expect(formatSince(ago(2 * 86_400), now)).toBe("2 d");
});

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

test("formatAgo says how long ago, in the largest whole unit", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  expect(formatAgo(new Date("2026-10-01T11:59:30Z"), now)).toBe("just now");
  expect(formatAgo(new Date("2026-10-01T11:55:00Z"), now)).toBe("5 minutes ago");
  expect(formatAgo(new Date("2026-10-01T11:00:00Z"), now)).toBe("1 hour ago");
  expect(formatAgo(new Date("2026-09-28T12:00:00Z"), now)).toBe("3 days ago");
});

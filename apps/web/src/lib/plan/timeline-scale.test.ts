import { expect, test } from "vitest";
import { defaultZoom, timeScale, visibleRange } from "./timeline-scale";

const cell = (label: string, x: number, width: number) => ({ label, x, width });

test("the weeks scale lays out day columns with week and month headers and the months scale lays out month columns with quarter headers", () => {
  // Wed Sep 9 to Wed Nov 4 widens to whole ISO weeks: Mon Sep 7 (W37) to Sun Nov 8 (W45), 63 days of 14 px.
  const weeks = timeScale({ start: "2026-09-09", end: "2026-11-04" }, "weeks");
  expect(weeks.range).toEqual({ start: "2026-09-07", end: "2026-11-08" });
  expect(weeks.width).toBe(882);
  expect(weeks.x("2026-09-07")).toBe(0);
  expect(weeks.x("2026-10-02")).toBe(350);
  expect(weeks.top).toEqual([cell("Sep 2026", 0, 336), cell("Oct 2026", 336, 434), cell("Nov 2026", 770, 112)]);
  expect(weeks.bottom.map((w) => w.label)).toEqual(["W37", "W38", "W39", "W40", "W41", "W42", "W43", "W44", "W45"]);
  expect(weeks.bottom[4]).toEqual(cell("W41", 392, 98));
  expect(weeks.weekends[0]).toEqual(cell("Sat", 70, 28));
  expect(weeks.weekends).toHaveLength(9);

  // Aug 10 2026 to Jan 20 2027 widens to whole months: Aug to Jan, 120 px each, under Q3 2026, Q4 2026 and Q1 2027.
  const months = timeScale({ start: "2026-08-10", end: "2027-01-20" }, "months");
  expect(months.range).toEqual({ start: "2026-08-01", end: "2027-01-31" });
  expect(months.width).toBe(720);
  expect(months.bottom).toEqual([cell("Aug", 0, 120), cell("Sep", 120, 120), cell("Oct", 240, 120), cell("Nov", 360, 120), cell("Dec", 480, 120), cell("Jan", 600, 120)]);
  expect(months.top).toEqual([cell("Q3 2026", 0, 240), cell("Q4 2026", 240, 360), cell("Q1 2027", 600, 120)]);
  expect(months.x("2026-10-16")).toBeCloseTo(240 + (15 / 31) * 120);
  expect(months.x("2027-02-01")).toBe(720);
  expect(months.weekends).toEqual([]);
});

test("the days scale lays out 96 px days with day and month headers", () => {
  // Wed Sep 30 to Fri Oct 2 widens to the whole ISO week, Mon Sep 28 to Sun Oct 4: 7 days of 96 px.
  const days = timeScale({ start: "2026-09-30", end: "2026-10-02" }, "days");
  expect(days.zoom).toBe("days");
  expect(days.range).toEqual({ start: "2026-09-28", end: "2026-10-04" });
  expect(days.width).toBe(672);
  expect(days.x("2026-10-01")).toBe(288);
  expect(days.xAt(new Date(2026, 9, 1, 6, 0, 0).toISOString())).toBe(312);
  expect(days.top).toEqual([cell("Sep 2026", 0, 288), cell("Oct 2026", 288, 384)]);
  expect(days.bottom).toEqual([
    cell("Mon 28", 0, 96),
    cell("Tue 29", 96, 96),
    cell("Wed 30", 192, 96),
    cell("Thu 1", 288, 96),
    cell("Fri 2", 384, 96),
    cell("Sat 3", 480, 96),
    cell("Sun 4", 576, 96),
  ]);
  expect(days.weekends).toEqual([cell("Sat", 480, 192)]);
});

test("the visible range starts a week before the earliest Start and ends two weeks after the latest Target, and spans at least eight weeks around today", () => {
  const spans = [
    { start: "2026-09-14", end: "2026-10-09" },
    { start: "2026-09-28", end: "2026-10-23" },
  ];
  expect(visibleRange(spans, "2026-10-02")).toEqual({ start: "2026-09-07", end: "2026-11-06" });
  expect(defaultZoom(visibleRange(spans, "2026-10-02"))).toBe("weeks");

  // Today before every span still opens the range a week before today.
  expect(visibleRange([{ start: "2026-12-01", end: "2026-12-10" }], "2026-10-02")).toEqual({ start: "2026-09-25", end: "2026-12-24" });
  expect(defaultZoom(visibleRange([{ start: "2026-12-01", end: "2026-12-10" }], "2026-10-02"))).toBe("months");

  // Nothing dated, or a short plan: eight weeks from two weeks before today.
  expect(visibleRange([], "2026-10-02")).toEqual({ start: "2026-09-18", end: "2026-11-12" });
  expect(visibleRange([{ start: "2026-10-05", end: "2026-10-06" }], "2026-10-02")).toEqual({ start: "2026-09-18", end: "2026-11-12" });
});

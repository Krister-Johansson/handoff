import { expect, test } from "vitest";
import type { DiffFile, DiffLine } from "@handoff/core";
import { diffRows, diffTotals } from "./diff-rows";

/** A whole file of `n` lines where line `changed` was replaced. */
function file(n: number, changed: number): DiffFile {
  const lines: DiffLine[] = [];
  for (let i = 1; i <= n; i++) {
    if (i === changed) {
      lines.push({ kind: "del", oldLine: i, text: `old ${i}` }, { kind: "add", newLine: i, text: `new ${i}` });
    } else
      lines.push({
        kind: "context",
        oldLine: i,
        newLine: i,
        text: `line ${i}`,
      });
  }
  return {
    path: "a.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    whole: true,
    hunks: [{ oldStart: 1, newStart: 1, lines }],
  };
}

test("the totals of a change add up every file's lines and count the files", () => {
  expect(diffTotals([file(20, 10), { ...file(5, 1), additions: 4, deletions: 0 }])).toEqual({ additions: 5, deletions: 1, files: 2 });
  expect(diffTotals([])).toEqual({ additions: 0, deletions: 0, files: 0 });
});

const shape = (rows: ReturnType<typeof diffRows>) =>
  rows.map((r) => (r.kind === "fold" ? `fold ${r.lines.length}` : r.kind === "gap" ? "gap" : `${r.line.kind} ${r.line.newLine ?? r.line.oldLine}`));

test("changes fold long unchanged runs and keep three lines around each change", () => {
  expect(shape(diffRows(file(20, 10), { mode: "changes", expanded: new Set() }))).toEqual([
    "fold 6",
    "context 7",
    "context 8",
    "context 9",
    "del 10",
    "add 10",
    "context 11",
    "context 12",
    "context 13",
    "fold 7",
  ]);
});

test("an expanded fold shows its lines, and the whole file shows everything", () => {
  const rows = diffRows(file(20, 10), { mode: "changes", expanded: new Set() });
  const first = rows[0]!;
  if (first.kind !== "fold") throw new Error("expected a fold");
  expect(
    shape(
      diffRows(file(20, 10), {
        mode: "changes",
        expanded: new Set([first.id]),
      }),
    ).slice(0, 7),
  ).toEqual(["context 1", "context 2", "context 3", "context 4", "context 5", "context 6", "context 7"]);
  expect(diffRows(file(20, 10), { mode: "whole", expanded: new Set() }).every((r) => r.kind === "line")).toBe(true);
});

test("a short unchanged run is not folded", () => {
  expect(shape(diffRows(file(5, 3), { mode: "changes", expanded: new Set() }))).toEqual(["context 1", "context 2", "del 3", "add 3", "context 4", "context 5"]);
});

test("separate hunks of a file that is not whole are split by a gap", () => {
  const f: DiffFile = {
    path: "b.ts",
    status: "modified",
    additions: 2,
    deletions: 0,
    whole: false,
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [{ kind: "add", newLine: 1, text: "a" }],
      },
      {
        oldStart: 40,
        newStart: 41,
        lines: [{ kind: "add", newLine: 41, text: "b" }],
      },
    ],
  };
  expect(shape(diffRows(f, { mode: "whole", expanded: new Set() }))).toEqual(["add 1", "gap", "add 41"]);
});

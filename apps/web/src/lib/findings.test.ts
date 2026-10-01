import { expect, test } from "vitest";
import type { DiffFile } from "@handoff/core";
import { placeFindings } from "./findings";

const file: DiffFile = {
  path: "src/a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  hunks: [
    {
      oldStart: 8,
      newStart: 8,
      lines: [
        { kind: "context", oldLine: 8, newLine: 8, text: "a" },
        { kind: "del", oldLine: 9, text: "b" },
        { kind: "add", newLine: 9, text: "c" },
      ],
    },
  ],
};

test("a finding sits on its line when the diff shows that line, else at the top of its file", () => {
  const placed = placeFindings(file, [
    { path: "src/a.ts", line: 9, body: "On the added line" },
    { path: "src/a.ts", line: 40, body: "Outside the hunk" },
    { path: "src/a.ts", body: "About the whole file" },
    { path: "src/b.ts", line: 1, body: "Another file" },
  ]);
  expect(placed.anchored).toEqual([{ line: 9, finding: { path: "src/a.ts", line: 9, body: "On the added line" } }]);
  expect(placed.loose.map((f) => f.body)).toEqual(["Outside the hunk", "About the whole file"]);
});

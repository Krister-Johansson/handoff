import { expect, test } from "vitest";
import type { DiffFile } from "@handoff/core";
import { commentedAt, placeEarlier } from "./earlier";

const file: DiffFile = {
  path: "a.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "const a = 1;" },
        { kind: "del", oldLine: 2, text: "const b = 2;" },
        { kind: "add", newLine: 2, text: "const b = 3;" },
        { kind: "context", oldLine: 3, newLine: 3, text: "  return a + b;" },
      ],
    },
  ],
};

test("an earlier comment anchors to the new lines that still hold its quoted code", () => {
  const placed = placeEarlier(file, [
    { path: "a.ts", line: 5, quote: "const b = 3;\n  return a + b;", body: "moved" },
    { path: "a.ts", line: 2, quote: "const b = 2;", body: "gone" },
    { path: "a.ts", line: 1, body: "no quote" },
    { path: "b.ts", line: 1, quote: "const a = 1;", body: "other file" },
  ]);
  expect(placed.anchored).toEqual([{ line: 3, comment: expect.objectContaining({ body: "moved" }) }]);
  expect(placed.outdated.map((c) => c.body)).toEqual(["gone", "no quote"]);
});

test("each file's latest comment time comes from the rounds that commented on it", () => {
  const t1 = new Date("2026-10-01T10:00:00Z");
  const t2 = new Date("2026-10-01T11:00:00Z");
  expect(
    commentedAt([
      { answer: "one", option: "changes", answeredAt: t1, comments: [{ path: "a.ts", body: "x" }, { body: "general" }] },
      { answer: "two", option: "changes", answeredAt: t2, comments: [{ path: "a.ts", body: "y" }, { path: "b.ts", body: "z" }] },
    ]),
  ).toEqual({ "a.ts": t2, "b.ts": t2 });
});

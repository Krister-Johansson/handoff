import { expect, test } from "vitest";
import { limitDiff, parseUnifiedDiff, type DiffFile } from "./diff.ts";

const Z = "0".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);

const modified = [
  "diff --git a/src/a.ts b/src/a.ts",
  `index ${A}..${B} 100644`,
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,4 +1,5 @@",
  " one",
  "-two",
  "+TWO",
  "+two and a half",
  " three",
  " four",
  "@@ -10,2 +11,2 @@ function tail() {",
  " ten",
  "-eleven",
  "+ELEVEN",
].join("\n");

test("a modified file keeps its hunks with old and new line numbers", () => {
  const [file] = parseUnifiedDiff(modified);
  expect(file).toMatchObject({ path: "src/a.ts", status: "modified", additions: 3, deletions: 2, blob: B });
  expect(file!.hunks).toHaveLength(2);
  expect(file!.hunks[0]!.lines).toEqual([
    { kind: "context", oldLine: 1, newLine: 1, text: "one" },
    { kind: "del", oldLine: 2, text: "two" },
    { kind: "add", newLine: 2, text: "TWO" },
    { kind: "add", newLine: 3, text: "two and a half" },
    { kind: "context", oldLine: 3, newLine: 4, text: "three" },
    { kind: "context", oldLine: 4, newLine: 5, text: "four" },
  ]);
  expect(file!.hunks[1]).toMatchObject({ oldStart: 10, newStart: 11 });
  expect(file!.hunks[1]!.lines.at(-1)).toEqual({ kind: "add", newLine: 12, text: "ELEVEN" });
});

test("added, deleted, renamed and binary files are told apart", () => {
  const text = [
    "diff --git a/new.ts b/new.ts",
    "new file mode 100644",
    `index ${Z}..${B}`,
    "--- /dev/null",
    "+++ b/new.ts",
    "@@ -0,0 +1,2 @@",
    "+export const a = 1;",
    "+export const b = 2;",
    "diff --git a/gone.ts b/gone.ts",
    "deleted file mode 100644",
    `index ${A}..${Z}`,
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
    "\\ No newline at end of file",
    "diff --git a/old name.ts b/new name.ts",
    "similarity index 90%",
    "rename from old name.ts",
    "rename to new name.ts",
    `index ${A}..${B} 100644`,
    "--- a/old name.ts",
    "+++ b/new name.ts",
    "@@ -1 +1 @@",
    "-x",
    "+y",
    "diff --git a/logo.png b/logo.png",
    "new file mode 100644",
    `index ${Z}..${B}`,
    "Binary files /dev/null and b/logo.png differ",
  ].join("\n");
  const files = parseUnifiedDiff(text);
  expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
    ["new.ts", "added", 2, 0],
    ["gone.ts", "deleted", 0, 1],
    ["new name.ts", "renamed", 1, 1],
    ["logo.png", "binary", 0, 0],
  ]);
  expect(files[1]!.hunks[0]!.lines).toEqual([{ kind: "del", oldLine: 1, text: "bye" }]);
  expect(files[1]!.blob).toBe(A);
  expect(files[2]!.oldPath).toBe("old name.ts");
  expect(files[3]!.hunks).toEqual([]);
});

test("a rename without content changes has no hunks", () => {
  const [file] = parseUnifiedDiff(["diff --git a/a.ts b/b.ts", "similarity index 100%", "rename from a.ts", "rename to b.ts"].join("\n"));
  expect(file).toMatchObject({ path: "b.ts", oldPath: "a.ts", status: "renamed", additions: 0, deletions: 0, hunks: [] });
});

test("an empty diff has no files", () => {
  expect(parseUnifiedDiff("")).toEqual([]);
});

function wholeFile(path: string, lines: number, changedAt: number): DiffFile {
  const [file] = parseUnifiedDiff(
    [
      `diff --git a/${path} b/${path}`,
      `index ${A}..${B} 100644`,
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -1,${lines} +1,${lines} @@`,
      ...Array.from({ length: lines }, (_, i) => (i + 1 === changedAt ? `+changed ${i + 1}` : ` line ${i + 1}`)),
    ].join("\n"),
  );
  // One added line in place of a context line keeps the arithmetic simple for these tests.
  return file!;
}

test("lock files and generated files keep their counts but not their lines", () => {
  const files = limitDiff([wholeFile("pnpm-lock.yaml", 20, 3), wholeFile("src/routeTree.gen.ts", 20, 3), wholeFile("src/a.ts", 20, 3)]);
  expect(files.map((f) => [f.path, f.collapsed, f.hunks.length, f.additions])).toEqual([
    ["pnpm-lock.yaml", "generated", 0, 1],
    ["src/routeTree.gen.ts", "generated", 0, 1],
    ["src/a.ts", undefined, 1, 1],
  ]);
  expect(files[2]!.whole).toBe(true);
});

test("a file too long to show whole keeps three lines of context around each change", () => {
  const [file] = limitDiff([wholeFile("src/big.ts", 100, 50)], { maxFileLines: 40 });
  expect(file!.whole).toBe(false);
  expect(file!.hunks).toHaveLength(1);
  expect(file!.hunks[0]!.lines.map((l) => l.newLine)).toEqual([47, 48, 49, 50, 51, 52, 53]);
  expect(file!.hunks[0]).toMatchObject({ oldStart: 47, newStart: 47 });
});

test("a file whose changes alone are too long is collapsed as large", () => {
  const huge = parseUnifiedDiff(
    ["diff --git a/x.ts b/x.ts", `index ${Z}..${B}`, "--- /dev/null", "+++ b/x.ts", "@@ -0,0 +1,50 @@", ...Array.from({ length: 50 }, (_, i) => `+l${i}`)].join("\n"),
  );
  const [file] = limitDiff(huge, { maxFileLines: 40 });
  expect(file).toMatchObject({ collapsed: "large", additions: 50, hunks: [] });
});

test("once the snapshot is full, later files lose context and then their lines", () => {
  const files = limitDiff([wholeFile("a.ts", 30, 15), wholeFile("b.ts", 30, 15), wholeFile("c.ts", 30, 15)], { maxTotalLines: 40 });
  expect(files.map((f) => [f.path, f.whole, f.collapsed, f.hunks.flatMap((h) => h.lines).length])).toEqual([
    ["a.ts", true, undefined, 30],
    ["b.ts", false, undefined, 7],
    ["c.ts", false, "limit", 0],
  ]);
});

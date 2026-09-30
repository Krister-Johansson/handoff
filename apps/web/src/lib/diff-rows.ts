import type { DiffFile, DiffLine } from "@handoff/core";

export type DiffRow = { kind: "line"; line: DiffLine } | { kind: "fold"; id: string; lines: DiffLine[] } | { kind: "gap"; id: string };

type Options = {
  mode: "changes" | "whole";
  expanded: ReadonlySet<string>;
  context?: number;
};

/**
 * The rows a file's diff shows. "changes" keeps `context` unchanged lines around each change and
 * folds longer unchanged runs into a row that expands; "whole" shows every line the snapshot has.
 * Hunks that are not adjacent (a file too long to keep whole) are split by a gap.
 */
export function diffRows(file: DiffFile, { mode, expanded, context = 3 }: Options): DiffRow[] {
  const rows: DiffRow[] = [];
  file.hunks.forEach((hunk, h) => {
    if (h > 0) rows.push({ kind: "gap", id: `${file.path}:gap:${h}` });
    const { lines } = hunk;
    let i = 0;
    while (i < lines.length) {
      if (lines[i]!.kind !== "context") {
        rows.push({ kind: "line", line: lines[i]! });
        i++;
        continue;
      }
      let end = i;
      while (end < lines.length && lines[end]!.kind === "context") end++;
      const run = lines.slice(i, end);
      const keepBefore = i === 0 ? 0 : context;
      const keepAfter = end === lines.length ? 0 : context;
      const hidden = run.length - keepBefore - keepAfter;
      const id = `${file.path}:${h}:${i}`;
      if (mode === "whole" || hidden < 2 || expanded.has(id)) {
        for (const line of run) rows.push({ kind: "line", line });
      } else {
        for (const line of run.slice(0, keepBefore)) rows.push({ kind: "line", line });
        rows.push({
          kind: "fold",
          id,
          lines: run.slice(keepBefore, run.length - keepAfter),
        });
        for (const line of run.slice(run.length - keepAfter)) rows.push({ kind: "line", line });
      }
      i = end;
    }
  });
  return rows;
}

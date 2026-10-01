import type { DiffFile } from "@handoff/core";

/** A comment from the code reviewing agent, on a file and usually a line. */
export type Finding = { path: string; line?: number | undefined; body: string };
/** What the code reviewing step decided, with its comments. */
export type Findings = { verdict: "approve" | "request_changes"; comments: Finding[] };

/** Where a file's findings go: next to their line when the diff shows it, else at the top of the file. */
export function placeFindings(file: DiffFile, findings: Finding[]) {
  const shown = new Set(file.hunks.flatMap((h) => h.lines).flatMap((l) => (l.kind !== "del" && l.newLine !== undefined ? [l.newLine] : [])));
  const anchored: { line: number; finding: Finding }[] = [];
  const loose: Finding[] = [];
  for (const finding of findings.filter((f) => f.path === file.path)) {
    if (finding.line !== undefined && shown.has(finding.line)) anchored.push({ line: finding.line, finding });
    else loose.push(finding);
  }
  return { anchored, loose };
}

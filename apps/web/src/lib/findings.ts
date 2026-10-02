import type { DiffFile } from "@handoff/core";

/** How much a finding matters; findings from before severities read as should_fix. */
export type Severity = "blocking" | "should_fix" | "follow_up";
/** A comment from the code reviewing agent, on a file and usually a line. */
export type Finding = { path: string; line?: number | undefined; body: string; severity?: Severity | undefined };
/** What the code reviewing step decided, with its comments. */
export type Findings = { verdict: "approve" | "request_changes"; comments: Finding[] };
/** The issue a person opened from a code review's findings. */
export type FollowUp = { number: number; url: string };

/** The severities in the order a review lists them, each with its heading. */
export const SEVERITIES: { severity: Severity; title: string }[] = [
  { severity: "blocking", title: "Blocking" },
  { severity: "should_fix", title: "Should fix" },
  { severity: "follow_up", title: "Follow-up" },
];

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

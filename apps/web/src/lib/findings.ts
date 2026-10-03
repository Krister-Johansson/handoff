import type { DiffFile } from "@handoff/core";

/** How much a finding matters; findings from before severities read as should_fix. */
export type Severity = "blocking" | "should_fix" | "follow_up";
/** A comment from the code reviewing agent, on a file and usually a line. */
export type Finding = { path: string; line?: number | undefined; body: string; severity?: Severity | undefined };
/** What the code reviewing step decided, with its comments. */
export type Findings = { verdict: "approve" | "request_changes"; comments: Finding[] };
/** The issue a person opened from a code review's findings, with those findings by their place in the review when known. */
export type FollowUp = { number: number; url: string; findings?: number[] | undefined };

/**
 * What the person does with a finding: send it back to the coder with the review (fix_now), leave it
 * for a follow-up issue, or skip it.
 */
export type Choice = "fix_now" | "follow_up" | "skip";

/** The choices in the order a finding offers them, each with its name. */
export const CHOICES: { choice: Choice; title: string }[] = [
  { choice: "fix_now", title: "Fix now" },
  { choice: "follow_up", title: "Follow-up" },
  { choice: "skip", title: "Skip" },
];
export const CHOICE_TITLES = Object.fromEntries(CHOICES.map((c) => [c.choice, c.title])) as Record<Choice, string>;

/** A finding's choice before the person picks one: Blocking and Should fix are fixed now, Follow-up waits. */
export const defaultChoice = (finding: Finding): Choice => (finding.severity === "follow_up" ? "follow_up" : "fix_now");

const isChoice = (value: unknown): value is Choice => typeof value === "string" && value in CHOICE_TITLES;

/**
 * Every finding's choice: the person's pick, or the default for its severity. A finding in the
 * follow-up issue stays Follow-up.
 */
export function choicesOf(findings: Finding[], picked: Readonly<Record<number, string>>, followUp?: FollowUp | undefined): Choice[] {
  const inIssue = new Set(followUp?.findings ?? []);
  return findings.map((f, i) => {
    if (inIssue.has(i)) return "follow_up";
    const own = picked[i];
    return isChoice(own) ? own : defaultChoice(f);
  });
}

/** The Fix now findings with their places in the review, in the order the summary lists them: by severity, then as found. */
export function fixNowOf(findings: Finding[], choices: Choice[]) {
  const rank = (f: Finding) => SEVERITIES.findIndex((s) => s.severity === (f.severity ?? "should_fix"));
  return findings
    .map((finding, index) => ({ index, finding }))
    .filter(({ index }) => choices[index] === "fix_now")
    .sort((a, b) => rank(a.finding) - rank(b.finding) || a.index - b.index);
}

/** Where a finding is: `path:line`, or the path alone. */
export const locationOf = (f: Finding) => (f.line !== undefined ? `${f.path}:${f.line}` : f.path);

/** A finding's place in short: the file's name and its line. */
export const shortLocationOf = (f: Finding) => {
  const name = f.path.split("/").at(-1) ?? f.path;
  return f.line !== undefined ? `${name}:${f.line}` : name;
};

/** The first sentence of a finding's text, without markdown's backticks, for a one-line list. */
export function firstSentence(body: string) {
  const text = body.trim().split(/\n\s*\n/)[0]!.replace(/`/g, "").replace(/\s+/g, " ");
  return text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
}

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

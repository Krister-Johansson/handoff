/**
 * CodeRabbit's summary comment.
 *
 * CodeRabbit keeps one issue comment per pull request and edits it in place on each
 * review. The comment marks its sections with HTML comments, which CodeRabbit appears
 * to use to find them when it edits the comment. The markers are not documented, so
 * everything here is read defensively: a section that is present but has an
 * unexpected shape becomes one raw finding and a problem, never nothing.
 *
 * Plan: docs/plans/review-threads.md, Decision 7.
 */
import { createHash } from "node:crypto";

/** The summary comment's first line. */
export const CODERABBIT_SUMMARY_FIRST_LINE = "<!-- This is an auto-generated comment: summarize by coderabbit.ai -->";

/** The login handoff reads the summary from unless told otherwise. */
export const CODERABBIT_LOGIN = "coderabbitai";

/**
 * The summary comment among a pull request's comments: the newest comment by the
 * author whose first line is the summary marker, or null. REST reports a GitHub App
 * as `coderabbitai[bot]` and GraphQL as `coderabbitai`; both match.
 */
export function findCodeRabbitSummary<C extends { author: string | null; body: string }>(
  comments: readonly C[],
  options: { author?: string } = {},
): C | null {
  const author = options.author ?? CODERABBIT_LOGIN;
  for (let i = comments.length - 1; i >= 0; i--) {
    const comment = comments[i]!;
    if (comment.author !== author && comment.author !== `${author}[bot]`) continue;
    if (firstLine(comment.body) === CODERABBIT_SUMMARY_FIRST_LINE) return comment;
  }
  return null;
}

/** What the summary comment says, read from its body. */
export type CodeRabbitSummary = {
  /**
   * The commit the summary's review covers: `coveredCommitId` from the
   * `final_review_risk_coverage` marker, else the `change_assessment_commit` marker,
   * else null.
   */
  coveredCommit: string | null;
  /**
   * CodeRabbit is reviewing a newer commit. The rest of the comment still describes
   * the earlier review, so the summary does not cover the head yet.
   */
  inProgress: boolean;
  /** The commit the review in progress is on, when its block names one. */
  reviewingCommit: string | null;
  /** The merge risk label of the final review risk section, such as "Low" or "Minimal". */
  mergeRisk: string | null;
  /** Walkthrough notes and failed pre-merge checks, in the order the comment lists them. */
  findings: SummaryFinding[];
  /** What could not be read as expected. Empty when the comment parsed cleanly. */
  problems: SummaryProblem[];
};

/**
 * One thing the summary asks of the pull request. `id` is stable across edits of the
 * comment and across rounds, so callers dedupe by it:
 *
 * - `note:<hash>` for a walkthrough note, a hash of its whitespace-normalised text, so
 *   a reworded note is a new finding;
 * - `check:<name>` for a failed pre-merge check, by the check's name, so a check
 *   whose explanation is reworded stays the same finding.
 */
export type SummaryFinding =
  | {
      kind: "summary_note";
      id: string;
      /** The paragraph, whitespace-normalised. */
      text: string;
    }
  | {
      kind: "pre_merge_check";
      id: string;
      name: string;
      /** The check's mode as the table states it, lower case: "warning" or "error" as recorded. */
      status: string;
      /** From the check's "Full details" block, else the table cell, which CodeRabbit cuts short. */
      explanation: string;
      resolution: string;
    }
  | {
      /**
       * A section whose markers are present but whose content does not have the
       * expected shape: its plain text, so nothing is dropped without a trace. The
       * parse also reports a problem for the section.
       */
      kind: "raw";
      /** `raw:<section>:<hash of the text>`. */
      id: string;
      section: SummarySection;
      text: string;
    };

/** The sections of the comment the parser reads. */
export type SummarySection = "final_review_risk" | "pre_merge_checks";

/** `body` when the comment has none of the markers the parser knows. */
export type SummaryProblem = { section: SummarySection | "body"; message: string };

const SHA = /^[0-9a-f]{7,40}$/i;
const IN_PROGRESS_START = "<!-- This is an auto-generated comment: review in progress by coderabbit.ai -->";
const IN_PROGRESS_END = "<!-- end of auto-generated comment: review in progress by coderabbit.ai -->";
const WALKTHROUGH_START = "<!-- walkthrough_start -->";
const RISK_START = "<!-- final_review_risk_start -->";
const RISK_END = "<!-- final_review_risk_end -->";
const COVERAGE_MARKER = /<!-- final_review_risk_coverage:.*?-->/;
const CHECKS_START = "<!-- pre_merge_checks_walkthrough_start -->";
const CHECKS_END = "<!-- pre_merge_checks_walkthrough_end -->";

/** Parses a summary comment's body. Pure, and never throws. */
export function parseCodeRabbitSummary(body: string): CodeRabbitSummary {
  const inProgress = between(body, IN_PROGRESS_START, IN_PROGRESS_END);
  const risk = between(body, RISK_START, RISK_END);
  const checks = between(body, CHECKS_START, CHECKS_END);
  const findings: SummaryFinding[] = [];
  const problems: SummaryProblem[] = [];
  const read = (section: SummarySection, text: string | null, reader: (text: string) => SectionRead) => {
    if (text === null) return;
    const result = reader(text);
    if ("unreadable" in result) {
      const plain = plainText(text);
      findings.push({ kind: "raw", id: `raw:${section}:${hash(plain)}`, section, text: plain });
      problems.push({ section, message: result.unreadable });
    } else {
      findings.push(...result.findings);
    }
  };
  read("final_review_risk", risk, readNotes);
  read("pre_merge_checks", checks, readChecks);
  if (inProgress === null && risk === null && checks === null && !body.includes(WALKTHROUGH_START)) {
    problems.push({ section: "body", message: "The comment has none of the summary's section markers." });
  }
  return {
    coveredCommit: readCoveredCommit(body),
    inProgress: inProgress !== null,
    reviewingCommit: inProgress === null ? null : readReviewingCommit(inProgress),
    mergeRisk: risk === null ? null : readMergeRisk(risk),
    findings,
    problems,
  };
}

/**
 * Whether the summary describes a finished review of the head commit, so its
 * findings are the reviewer's word on the head (Decision 7).
 */
export function summaryCoversHead(summary: CodeRabbitSummary, headSha: string): boolean {
  if (summary.inProgress || !summary.coveredCommit) return false;
  return summary.coveredCommit.toLowerCase() === headSha.toLowerCase();
}

/** A section's findings, or why its content does not have the expected shape. */
type SectionRead = { findings: SummaryFinding[] } | { unreadable: string };

/**
 * The final review risk section is a "Merge Risk" line, the coverage marker, and the
 * walkthrough notes: each paragraph after the marker is one note.
 */
function readNotes(section: string): SectionRead {
  const marker = COVERAGE_MARKER.exec(section);
  if (!marker) return { unreadable: "The final review risk section has no final_review_risk_coverage marker, so its notes cannot be told apart." };
  const findings = paragraphs(section.slice(marker.index + marker[0].length))
    .filter((p) => !p.startsWith("**Merge Risk:**"))
    .map((text): SummaryFinding => ({ kind: "summary_note", id: `note:${hash(text)}`, text }));
  return { findings };
}

/**
 * The pre-merge checks section: a "Failed checks (n warning)" heading over a table
 * with the columns Check name, Status, Explanation and Resolution, a table of passed
 * checks in its own `<details>`, and a "Full details: <name>" block for each failed
 * check whose cells were cut short. Only the failed table's rows are findings.
 */
function readChecks(section: string): SectionRead {
  const heading = /^#{1,6}[^\n]*Failed checks\b[^\n]*$/m.exec(section);
  if (!heading) {
    // "🚥 Pre-merge checks | ✅ 5 | ❌ 1": without a failed count, a passed table is the only sign the section is as expected.
    const failed = /Pre-merge checks[^\n]*❌\s*(\d+)/.exec(section);
    if (failed && Number(failed[1]) > 0) return { unreadable: `The section counts ${failed[1]} failed checks but has no failed checks heading.` };
    if (!failed && !/Passed checks/.test(section)) return { unreadable: "The section has neither a failed checks heading nor a passed checks table." };
    return { findings: [] };
  }
  const table = readTable(section.slice(heading.index + heading[0].length));
  if (!table) return { unreadable: "The failed checks heading is not followed by a table." };
  const column = (name: RegExp) => table.header.findIndex((h) => name.test(h));
  const nameAt = column(/^check name$/i);
  const statusAt = column(/^status$/i);
  const explanationAt = column(/^explanation$/i);
  const resolutionAt = column(/^resolution$/i);
  if (nameAt < 0 || statusAt < 0 || explanationAt < 0) {
    return { unreadable: `The failed checks table has the columns ${table.header.join(", ")}, not Check name, Status and Explanation.` };
  }
  if (table.rows.length === 0) return { unreadable: "The failed checks table has no rows." };
  const findings = table.rows.map((cells): SummaryFinding => {
    const name = normalise(cells[nameAt] ?? "");
    const details = readFullDetails(section, name);
    return {
      kind: "pre_merge_check",
      id: `check:${name}`,
      name,
      status: normalise((cells[statusAt] ?? "").replace(/[^\p{L}\s]/gu, "")).toLowerCase(),
      explanation: details.explanation ?? normalise(cells[explanationAt] ?? ""),
      resolution: details.resolution ?? normalise(resolutionAt < 0 ? "" : (cells[resolutionAt] ?? "")),
    };
  });
  return { findings };
}

/** The first markdown table in `text`, skipping blank lines before it. */
function readTable(text: string): { header: string[]; rows: string[][] } | null {
  const lines = text.split("\n").map((l) => l.trim());
  let i = 0;
  while (i < lines.length && lines[i] === "") i++;
  const tableLines: string[] = [];
  while (i < lines.length && lines[i]!.startsWith("|")) tableLines.push(lines[i++]!);
  if (tableLines.length < 2) return null;
  const [header, separator, ...rows] = tableLines.map(cellsOf);
  if (!header || !separator || !separator.every((c) => /^:?-+:?$/.test(c))) return null;
  return { header, rows };
}

/** A table row's cells. A pipe escaped as `\|` stays inside its cell. */
function cellsOf(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());
}

/** The **Explanation** and **Resolution** paragraphs of a check's "Full details" block, each when present. */
function readFullDetails(section: string, name: string): { explanation: string | undefined; resolution: string | undefined } {
  const summary = `<summary>Full details: ${name}</summary>`;
  const from = section.indexOf(summary);
  if (from < 0) return { explanation: undefined, resolution: undefined };
  const end = section.indexOf("</details>", from);
  const block = section.slice(from + summary.length, end < 0 ? undefined : end);
  // The block is a run of "**Label**" lines, each followed by its paragraphs.
  const parts = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of block.split("\n")) {
    const label = /^\s*\*\*(\w+)\*\*\s*$/.exec(line);
    if (label) parts.set(label[1]!.toLowerCase(), (current = []));
    else current?.push(line);
  }
  const part = (label: string) => {
    const text = paragraphs((parts.get(label) ?? []).join("\n")).join("\n\n");
    return text || undefined;
  };
  return { explanation: part("explanation"), resolution: part("resolution") };
}

/** "**Merge Risk:** _🔵 Low_ · up to `501f7`" reads as "Low". */
function readMergeRisk(section: string): string | null {
  const line = /\*\*Merge Risk:\*\*\s*_([^_]+)_/.exec(section);
  if (!line) return null;
  const label = line[1]!.replace(/^[^\p{L}]+/u, "").trim();
  return label || null;
}

/** "Reviewing files that changed from the base of the PR and between <from> and <to>." */
function readReviewingCommit(block: string): string | null {
  const range = /between\s+([0-9a-f]{7,40})\s+and\s+([0-9a-f]{7,40})/i.exec(block);
  return range ? range[2]! : null;
}

function readCoveredCommit(body: string): string | null {
  const coverage = /<!-- final_review_risk_coverage:(\{.*?\}) -->/.exec(body);
  if (coverage) {
    const covered = jsonField(coverage[1]!, "coveredCommitId");
    if (covered && SHA.test(covered)) return covered;
  }
  const assessed = /<!-- change_assessment_commit:"([0-9a-f]{7,40})" -->/i.exec(body);
  return assessed ? assessed[1]! : null;
}

function jsonField(json: string, field: string): string | null {
  try {
    const value: unknown = JSON.parse(json);
    if (value && typeof value === "object" && field in value) {
      const v = (value as Record<string, unknown>)[field];
      return typeof v === "string" ? v : null;
    }
  } catch {
    // Not JSON; the caller falls back.
  }
  return null;
}

/** The text between two markers, or null when the start marker is missing. A missing end marker runs to the end. */
function between(body: string, start: string, end: string): string | null {
  const from = body.indexOf(start);
  if (from < 0) return null;
  const to = body.indexOf(end, from + start.length);
  return body.slice(from + start.length, to < 0 ? undefined : to);
}

/** Markdown paragraphs without HTML comments, each whitespace-normalised. */
function paragraphs(text: string): string[] {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/\n\s*\n/)
    .map(normalise)
    .filter((p) => p.length > 0);
}

/** A section's text without HTML comments or tags, with runs of blank lines collapsed. */
function plainText(section: string): string {
  return section
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hash(text: string): string {
  return createHash("sha256").update(normalise(text)).digest("hex").slice(0, 16);
}

function firstLine(body: string): string {
  return body.trimStart().split("\n", 1)[0]!.trim();
}

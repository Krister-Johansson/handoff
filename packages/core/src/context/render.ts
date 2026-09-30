export type CheckResult = { kind: string; passed: boolean; detail: string; logTail?: string | undefined; durationMs?: number | undefined };

/** A comment on code (path and line) or on a quoted part of a text such as a plan. */
export type ReviewComment = {
  author: string;
  path?: string | undefined;
  line?: number | undefined;
  endLine?: number | undefined;
  quote?: string | undefined;
  body: string;
  resolved: boolean;
};

type Place = { path?: string | undefined; line?: number | undefined; endLine?: number | undefined };

/** Where a comment points: `src/a.ts:3-4`, `src/a.ts:3`, `src/a.ts`, or nothing. */
const placeOf = (c: Place) => (c.path ? `${c.path}${c.line !== undefined ? `:${c.line}${c.endLine !== undefined && c.endLine !== c.line ? `-${c.endLine}` : ""}` : ""}` : "");
const quoted = (q: string) => `"${q.replace(/\s+/g, " ").trim()}"`;

export type ContextPacket = {
  task: string;
  nodeKey: string;
  stateSlice: Record<string, unknown>;
  repoPaths: string[];
  constraints: { ownedPaths: string[]; allowedTools: string[]; maxTurns: number };
  outputContract: string;
  /** The step's own instructions from the graph, on top of its built-in role. */
  instructions?: string;
  /** What people decided at review gates earlier in the run: binding for every later step. */
  decisions?: { gate: string; note?: string | undefined; comments: ({ quote?: string | undefined; body: string } & Place)[] }[];
  /** Comments reviewers left with an approval earlier in the run: advice, below the person's decisions. */
  suggestions?: { from: string; comments: { path?: string | undefined; line?: number | undefined; body: string }[] }[];
  issues?: { number: number; title: string; url: string; body: string }[];
  priorAttempt?: { summary?: string; failedChecks: CheckResult[]; reviewComments: ReviewComment[] };
  humanAnswer?: string;
  repairNote?: string;
};

const LOG_TAIL_LINES = 80;
const ISSUE_BODY_CHARS = 4000;

const tail = (text: string, n: number) => text.split("\n").slice(-n).join("\n");
const list = (items: string[], empty: string) => (items.length ? items.map((i) => `- ${i}`).join("\n") : empty);

/** The context packet as markdown, appended to the agent's system prompt. Never contains event history. */
export function renderContextPacket(packet: ContextPacket): string {
  const out: string[] = [];
  out.push("# Task", "", packet.task, "");
  if (packet.instructions) out.push("# Instructions for this step", "", packet.instructions, "");
  if (packet.decisions?.length) {
    out.push(
      "# Decisions from the person reviewing this run",
      "",
      "A person made these decisions at a review earlier in this run. Follow them. They take precedence over comments from reviewers and over conventions you find in the repository.",
      "",
    );
    for (const decision of packet.decisions) {
      if (decision.note) out.push(`- ${decision.note}`);
      for (const c of decision.comments) {
        const place = placeOf(c);
        const on = c.quote ? `${place ? `${place} on` : "On"} ${quoted(c.quote)}: ` : place ? `${place}: ` : "";
        out.push(`- ${on}${c.body}`);
      }
    }
    out.push("");
  }
  if (packet.suggestions?.length) {
    out.push(
      "# Suggestions from reviewers",
      "",
      "A reviewer approved earlier work in this run and left these suggestions. Apply the ones that fit this step. Decisions from the person take precedence.",
      "",
    );
    for (const s of packet.suggestions) {
      for (const c of s.comments) out.push(`- ${c.path ? `${c.path}${c.line !== undefined ? `:${c.line}` : ""} - ` : ""}${s.from}: ${c.body}`);
    }
    out.push("");
  }
  if (packet.issues?.length) {
    out.push("# Linked issues", "", "The task works on these GitHub issues. The pull request closes them when it merges.", "");
    for (const issue of packet.issues) {
      const body = issue.body.trim();
      const cut = body.length > ISSUE_BODY_CHARS;
      out.push(`## #${issue.number} ${issue.title}`, "", issue.url, "");
      if (body) out.push(cut ? `${body.slice(0, ISSUE_BODY_CHARS)}\n\n(issue body cut at ${ISSUE_BODY_CHARS} characters)` : body, "");
    }
  }
  out.push("# Run state", "", "```json", JSON.stringify(packet.stateSlice, null, 2), "```", "");
  out.push(
    "# Repository context",
    "",
    "The current working directory is a git worktree of the repository on this run's branch.",
    "",
    "Relevant paths:",
    list(packet.repoPaths, "- (none specified)"),
    "",
  );
  out.push(
    "# Constraints",
    "",
    packet.constraints.ownedPaths.length
      ? `- Only change files under: ${packet.constraints.ownedPaths.join(", ")}. If the change needs a file outside these, list it in extraPaths with the reason; any other file outside them fails the step.`
      : "- Only change files under: (no restriction)",
    `- Tools available: ${packet.constraints.allowedTools.join(", ") || "(none)"}`,
    `- Turn budget: ${packet.constraints.maxTurns}`,
    "- Commit your changes with git before finishing. Do not push.",
    "- If you start a server or a watcher, stop it before you finish. Do not use port 3000: the handoff dashboard runs there.",
    "",
  );
  out.push(
    "# Output contract",
    "",
    `Finish by returning structured output that matches the \`${packet.outputContract}\` schema.`,
    "If you cannot proceed without a decision from a person, return status `needs_input` with a question instead of guessing.",
    "",
  );
  if (packet.priorAttempt || packet.humanAnswer || packet.repairNote) {
    out.push("# Previous attempt", "");
    if (packet.priorAttempt?.summary) out.push(packet.priorAttempt.summary, "");
    const failed = packet.priorAttempt?.failedChecks.filter((c) => !c.passed) ?? [];
    if (failed.length) {
      out.push("## Failed checks", "");
      for (const check of failed) {
        out.push(`### ${check.kind}: ${check.detail}`, "");
        if (check.logTail) out.push("```", tail(check.logTail, LOG_TAIL_LINES), "```", "");
      }
    }
    const open = packet.priorAttempt?.reviewComments.filter((c) => !c.resolved) ?? [];
    if (open.length) {
      out.push("## Review comments", "");
      for (const c of open) {
        const where = c.path ? `${placeOf(c)} - ` : "";
        const quote = c.quote ? ` on ${quoted(c.quote)}` : "";
        out.push(`- ${where}${c.author}${quote}: ${c.body}`);
      }
      out.push("");
    }
    if (packet.humanAnswer) out.push("## Human answer", "", packet.humanAnswer, "");
    if (packet.repairNote) out.push("## Operator note", "", packet.repairNote, "");
  }
  return out.join("\n");
}

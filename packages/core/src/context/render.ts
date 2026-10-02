import type { NodeMemory } from "../schema/run-state.ts";

/** A deterministic check's result; a path check that failed names the files outside the plan in `files`. */
export type CheckResult = { kind: string; passed: boolean; detail: string; logTail?: string | undefined; durationMs?: number | undefined; files?: string[] | undefined };

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
  /** The linked issues; `lineage` holds each one's parent and grandparent, nearest first. */
  issues?: {
    number: number;
    title: string;
    url: string;
    body: string;
    lineage?: { kind?: string | undefined; number: number; title: string; body: string }[] | undefined;
  }[];
  /** The run's app, started from its worktree for this step to walk through in a browser. */
  app?: { url: string };
  /** What a person will check in the running app to see the task is done. */
  acceptance?: { source: "issue" | "planner"; items: string[] };
  /** A reviewer's own last review of this work, when it runs again: what it asked for and what came back. */
  previousReview?: { comments: ({ body: string } & Place)[]; reply?: string | undefined; reviewedAt?: string | undefined };
  priorAttempt?: { summary?: string; failedChecks: CheckResult[]; reviewComments: ReviewComment[] };
  humanAnswer?: string;
  repairNote?: string;
  /** What earlier attempts of this step were told in this run: allowed files, operator notes, answers. */
  memory?: NodeMemory;
  /**
   * Where the step works: the run's branch, the project's setup command that ran in its worktree (null
   * when the project has none), and the project's notes about its environment. Steps with a worktree only.
   */
  environment?: { branch: string; setupCommand: string | null; agentNotes?: string | undefined };
  /** The base branch moved and now changes the same lines as this branch: the work is to merge it in. */
  conflict?: { base: string; baseSha: string; files: string[] };
};

/** Lockfiles the package manager writes; merged by taking the base branch's and reinstalling. */
const LOCKFILES = "`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `poetry.lock`, `uv.lock`, `go.sum`";

function renderConflict({ base, baseSha, files }: NonNullable<ContextPacket["conflict"]>): string[] {
  return [
    `# Merge conflict with ${base}`,
    "",
    `${base} moved while this run worked, and its latest commit (${baseSha.slice(0, 7)}) changes the same lines as this branch in:`,
    "",
    list(files, "- (no file list)"),
    "",
    "Your job this time is to bring the branch up to date and resolve the conflicts:",
    "",
    `1. Run \`git merge ${baseSha}\` in the worktree. It stops at the conflicting files.`,
    `2. For each file, find out what ${base} changed and why: \`git log --oneline HEAD..${baseSha} -- <file>\` names the commits, usually a merged pull request each.`,
    `3. Resolve each file so both changes survive: keep what ${base} added and what this run added. Do not drop either side to make the conflict go away.`,
    `4. Lockfiles (${LOCKFILES}): never merge them by hand. Take ${base}'s version (\`git checkout --theirs <file>\`), then run the package manager's install so it matches the merged manifest.`,
    "5. Docs, changelogs and READMEs: keep both sides' additions, in a sensible order.",
    "6. Commit the merge with `git commit --no-edit`. Do not rebase and do not force-push; the pull request step pushes.",
    "7. Run the tests and fix anything the merge broke.",
    "8. List any file outside the plan's paths that you had to change to resolve a conflict in `extraPaths`, with the reason.",
    "",
    "If you cannot tell how two changes should combine, return status `needs_input` with a question that shows both sides, instead of guessing.",
    "",
  ];
}

/** What earlier attempts of the step were told, which still holds for this attempt. */
function renderMemory({ extraPaths, notes, answers }: NodeMemory): string[] {
  if (!extraPaths.length && !notes.length && !answers.length) return [];
  const out = ["# Earlier in this run", "", "Earlier attempts of this step were told the following. It still holds for this attempt.", ""];
  if (extraPaths.length) {
    out.push("## Files outside the plan you may change", "", "An earlier attempt changed these with a reason. You may keep and change them without listing them in extraPaths again.", "");
    out.push(...extraPaths.map((e) => `- \`${e.path}\`: ${e.reason}`), "");
  }
  if (notes.length) out.push("## Notes from the operator", "", ...notes.map((n) => `- ${n.note}`), "");
  if (answers.length) {
    out.push("## Answers to your questions", "", "A person answered these. Keep to the answers.", "");
    out.push(...answers.map((a) => `- ${quoted(a.question)} ${a.option && a.option !== a.answer ? `${a.option}: ` : ""}${a.answer}`), "");
  }
  return out;
}

/** The worktree the step works in: its branch, what setup installed, and the run's identity. */
function renderWorktree(environment: ContextPacket["environment"]): string[] {
  if (!environment) return ["The current working directory is a git worktree of the repository on this run's branch.", ""];
  const { branch, setupCommand } = environment;
  return [
    `The current working directory is a git worktree of the repository on this run's branch, \`${branch}\`. Commit to it. Do not create or switch to another branch.`,
    "",
    setupCommand
      ? `The project's setup command, \`${setupCommand}\`, ran in this worktree before this step. What it installs and creates is in place.`
      : "The project has no setup command, so nothing was installed in this worktree before this step. Install what you need with the repository's own tools.",
    "",
    "The environment has HANDOFF_RUN_ID, HANDOFF_RUN_SHORT (its first eight characters) and HANDOFF_WORKTREE. Other runs work on the same machine at the same time: name anything you create outside the worktree, such as a test database, after HANDOFF_RUN_SHORT.",
    "",
  ];
}

const LOG_TAIL_LINES = 80;
const ISSUE_BODY_CHARS = 4000;

/** "Story", "Epic" or "Task" for a parent's kind; "Parent" when it has none. */
const kindName = (kind: string | undefined) => (kind ? `${kind[0]!.toUpperCase()}${kind.slice(1)}` : "Parent");
/** A body cut at ISSUE_BODY_CHARS, with a note naming what was cut. */
const cutBody = (body: string, what: string) =>
  body.length > ISSUE_BODY_CHARS ? `${body.slice(0, ISSUE_BODY_CHARS)}\n\n(${what} body cut at ${ISSUE_BODY_CHARS} characters)` : body;
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
      out.push(`## #${issue.number} ${issue.title}`, "", issue.url, "");
      if (issue.lineage?.length) {
        // The story and the epic are context: the issue's own body says what to build.
        out.push("### Part of", "");
        for (const parent of issue.lineage) {
          const kind = kindName(parent.kind);
          out.push(`${kind} #${parent.number} ${quoted(parent.title)}: ${cutBody(parent.body.trim(), kind.toLowerCase())}`, "");
        }
        if (body) out.push("### This issue", "");
      }
      if (body) out.push(cutBody(body, "issue"), "");
    }
  }
  if (packet.acceptance?.items.length) {
    const from = packet.acceptance.source === "issue" ? "The linked issues list these" : "The planner wrote these, and a person approved them with the plan";
    out.push("# Acceptance criteria", "", `${from}. A person checks each one in the running app before the work ships.`, "", ...packet.acceptance.items.map((item) => `- ${item}`), "");
  }
  if (packet.app) {
    out.push(
      "# The running app",
      "",
      `The app this run builds is running at ${packet.app.url}. The playwright tools drive a headless browser that can only reach it.`,
      "",
      "Walk through each acceptance criterion in the app as a person would. For each one, take a screenshot that shows it with browser_take_screenshot, without a filename, and note the file name the tool reports. Take at most 12 screenshots.",
      "In shots, give each screenshot's file name, a one-line caption a person reads under the image, the criterion it shows, and whether that criterion works. For the criterion, copy the criterion word for word from the list, so the screenshot shows under it; leave it out for a screenshot that shows none. Do not edit files.",
      "",
    );
  }
  if (packet.previousReview) {
    const { comments, reply, reviewedAt } = packet.previousReview;
    out.push(
      "# Your previous review",
      "",
      "You reviewed this work before and sent it back with the comments below. For each one, check whether the changes since then handle it.",
      reviewedAt
        ? `Then look only for new problems in lines changed since your last review (\`git diff ${reviewedAt}..HEAD\`). Do not raise findings on code you already reviewed and left alone.`
        : "Then look only for new problems the changes since then introduced. Do not raise findings on code you already reviewed and left alone.",
      "",
      "## Your comments",
      "",
      ...comments.map((c) => `- ${c.path ? `${placeOf(c)}: ` : ""}${c.body}`),
      "",
    );
    if (reply) out.push("## What was changed since", "", reply, "");
  }
  out.push("# Run state", "", "```json", JSON.stringify(packet.stateSlice, null, 2), "```", "");
  out.push("# Repository context", "", ...renderWorktree(packet.environment), "Relevant paths:", list(packet.repoPaths, "- (none specified)"), "");
  const notes = packet.environment?.agentNotes?.trim();
  if (notes) out.push("# About this project's environment", "", notes, "");
  out.push(
    "# Constraints",
    "",
    packet.constraints.ownedPaths.length
      ? `- Only change files under: ${packet.constraints.ownedPaths.join(", ")}. If the change needs a file outside these, list it in extraPaths with the reason; any other file outside them fails the step.`
      : "- Only change files under: (no restriction)",
    `- Tools available: ${packet.constraints.allowedTools.join(", ") || "(none)"}`,
    `- Turn budget: ${packet.constraints.maxTurns}`,
    "- Commit your changes with git before finishing. Do not push.",
    "- Follow the repository's commit conventions. Add no trailers, such as Co-Authored-By, unless the repository asks for them.",
    "- If you start a server or a watcher, stop it before you finish. Do not use port 3000: the handoff dashboard runs there.",
    "",
  );
  if (packet.conflict) out.push(...renderConflict(packet.conflict));
  out.push(
    "# Output contract",
    "",
    `Finish by returning structured output that matches the \`${packet.outputContract}\` schema.`,
    "If you cannot proceed without a decision from a person, return status `needs_input` with a question instead of guessing.",
    "Give the question a `summary` of at most 80 characters that names the decision. Notifications show the summary; the person reads the full `text` when they answer.",
    "",
  );
  if (packet.memory) out.push(...renderMemory(packet.memory));
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

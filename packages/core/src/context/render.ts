import type { NodeMemory, PreviousRun } from "../schema/run-state.ts";

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

/** What a review item is on GitHub: an inline thread, a review summary, or a note or check in a review bot's summary comment. */
export type ReviewItemKind = "thread" | "review_body" | "summary_note" | "pre_merge_check";

/**
 * An external reviewer's comment the coder answers by its handle (`R1`): what the reviewer said, where,
 * and the rest of its thread when it came back with a reply.
 */
export type ReviewItem = {
  id: string;
  kind?: ReviewItemKind | undefined;
  author: string;
  path?: string | undefined;
  line?: number | undefined;
  url?: string | undefined;
  body: string;
  conversation?: { author: string; body: string }[] | undefined;
};

const KIND_LABELS: Record<ReviewItemKind, string> = { thread: "thread", review_body: "review", summary_note: "summary note", pre_merge_check: "pre-merge check" };

/** The rule for review comments: check each claim like a test before acting on it, then answer it. */
export const REVIEW_ITEMS_RULE =
  "Treat each review comment like a test. Check its claim before you act: run the command it names, read the code it points at, or, when it is about the code's behaviour, write a failing test that shows it. " +
  "If the claim holds, fix it, commit, and give the commit. If it does not hold, change nothing for it and give the evidence: the command and its output, the file and lines, or the test that passes. " +
  "A summary note or pre-merge check fixed without a code change, such as through the pull request's title or description, needs no commit: say what changed in the evidence. " +
  "If you cannot tell, say what is unclear. Answer every listed comment in `answers`. Do not reply on GitHub; handoff posts your answers.";

function renderReviewItems(items: ReviewItem[]): string[] {
  const out = [
    "# Review comments to answer",
    "",
    REVIEW_ITEMS_RULE,
    "",
    "Give one answer per comment, by its handle: `fixed` with the commit, `declined` or `unclear` with the evidence, `duplicate` with the handle it repeats in `of`, or, for a comment that came back with the reviewer's reply, `settled` when that reply accepts the earlier answer.",
    "",
  ];
  for (const item of items) {
    const where = item.path ? ` on ${placeOf(item)}` : "";
    out.push(`## ${item.id}: ${item.kind ? KIND_LABELS[item.kind] : "comment"} by ${item.author}${where}`, "");
    if (item.url) out.push(item.url, "");
    out.push(item.body, "");
    if (item.conversation?.length) out.push("The thread since:", "", ...item.conversation.map((c) => `- ${c.author}: ${c.body}`), "");
  }
  return out;
}

/** Another run's work a plan's owned paths meet, as a plan gate lists it: the run, its branch and issues, the shared paths, and its open pull request. */
export type PlanOverlap = { runId: string; task: string; branch: string; issues: { number: number; title: string }[]; paths: string[]; pr?: number };

/** The project's other work a planner plans around: active runs and the open pull requests handoff opened. */
export type OtherWork = {
  runs: { runId: string; task: string; branch: string; issues: { number: number; title: string }[]; ownedPaths: string[] }[];
  pulls: { runId: string; task: string; issues: { number: number; title: string }[]; number: number; url: string; branch: string; files: string[] }[];
};

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
  /** For a review: whether any coder has passed in the run yet. Before one has, there is only a plan to review. */
  stage?: "plan" | "code";
  /** What people decided at review gates earlier in the run: binding for every later step. */
  decisions?: { gate: string; note?: string | undefined; comments: ({ quote?: string | undefined; body: string } & Place)[] }[];
  /** Comments reviewers left with an approval earlier in the run: advice, below the person's decisions. */
  suggestions?: { from: string; comments: { path?: string | undefined; line?: number | undefined; body: string }[] }[];
  /** The linked issues; `lineage` holds each one's parent and grandparent, nearest first, and `comments` are newest first. */
  issues?: {
    number: number;
    title: string;
    url: string;
    body: string;
    lineage?: { kind?: string | undefined; number: number; title: string; body: string }[] | undefined;
    comments?: { author: string; createdAt: string; body: string }[] | undefined;
  }[];
  /**
   * For a planner: the most files and steps a plan may have, and whether it may propose a split into
   * parts instead, which needs a plan gate after it for a person to accept.
   */
  budget?: { files: number; steps: number; canSplit: boolean };
  /** For a planner: the project's other active runs with what their plans own, and handoff's open pull requests with the files they change. */
  otherWork?: OtherWork;
  /** The run's app, started from its worktree for this step to walk through in a browser. */
  app?: { url: string };
  /** What a person will check in the running app to see the task is done. */
  acceptance?: { source: "issue" | "planner"; items: string[] };
  /**
   * A reviewer's own last review of this work, when it runs again: its verdict and findings, what the
   * step it sent the work back to said it changed, and the commit it reviewed.
   */
  previousReview?: {
    verdict?: "approve" | "request_changes" | undefined;
    comments: ({ body: string; severity?: string | undefined } & Place)[];
    reply?: string | undefined;
    reviewedAt?: string | undefined;
  };
  priorAttempt?: { summary?: string; failedChecks: CheckResult[]; reviewComments: ReviewComment[] };
  /** External review comments a pull request step sent this coder to answer, each by its handle. */
  reviewItems?: ReviewItem[];
  humanAnswer?: string;
  repairNote?: string;
  /** What earlier attempts of this step were told in this run: allowed files, operator notes, answers. */
  memory?: NodeMemory;
  /**
   * Where the step works: the run's branch, the base branch it started from, the project's setup command
   * that ran in its worktree (null when the project has none), and the project's notes about its
   * environment. Steps with a worktree only.
   */
  environment?: { branch: string; base: string; setupCommand: string | null; agentNotes?: string | undefined };
  /** For a planner: the failed run this run continues, whose branch this run's branch starts from. */
  earlierRun?: PreviousRun;
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

/** The run this one continues: where its branch ended, its plan, the decisions made in it, and the findings left open. */
function renderEarlierRun({ branch, plan, decisions, findings }: PreviousRun): string[] {
  const out = [
    "# An earlier run of this task",
    "",
    `An earlier run of this task failed, and a person ran it again from its branch, \`${branch}\`. This run's branch starts where that branch ended, so the earlier run's commits are already in the worktree.`,
    "Plan the rest of the work: keep what the earlier run built that fits the task, fix what its reviews found, and do not redo what its commits already do. Read the commits with `git log` before you plan.",
    "",
  ];
  if (plan) out.push("## Its plan", "", plan.plan, "", ...plan.steps.map((s) => `- ${s}`), "");
  if (decisions.length) {
    out.push("## Decisions a person made in it", "", "They still hold.", "");
    for (const d of decisions) {
      if (d.note) out.push(`- ${d.note}`);
      for (const c of d.comments) {
        const place = placeOf(c);
        out.push(`- ${c.quote ? `${place ? `${place} on` : "On"} ${quoted(c.quote)}: ` : place ? `${place}: ` : ""}${c.body}`);
      }
    }
    out.push("");
  }
  if (findings.length) {
    out.push("## Review findings it left open", "", ...findings.map((f) => `- ${f.severity ? `[${f.severity}] ` : ""}${f.path ? `${placeOf(f)}: ` : ""}${f.body}`), "");
  }
  return out;
}

/** The worktree the step works in: its branch, what setup installed, and the run's identity. */
function renderWorktree(environment: ContextPacket["environment"]): string[] {
  if (!environment) return ["The current working directory is a git worktree of the repository on this run's branch.", ""];
  const { branch, base, setupCommand } = environment;
  return [
    `The current working directory is a git worktree of the repository on this run's branch, \`${branch}\`. Commit to it. Do not create or switch to another branch.`,
    "",
    `The run's changes are what differs from \`origin/${base}\`: compare with it, as in \`git log origin/${base}..HEAD\`.`,
    "",
    setupCommand
      ? `The project's setup command, \`${setupCommand}\`, ran in this worktree before this step. What it installs and creates is in place.`
      : "The project has no setup command, so nothing was installed in this worktree before this step. Install what you need with the repository's own tools.",
    "",
    "The environment has HANDOFF_RUN_ID, HANDOFF_RUN_SHORT (its first eight characters) and HANDOFF_WORKTREE. Other runs work on the same machine at the same time: name anything you create outside the worktree, such as a test database, after HANDOFF_RUN_SHORT.",
    "",
  ];
}

/**
 * An issue's comments, newest first, as many whole comments as fit in ISSUE_BODY_CHARS, the budget a
 * body has. A newest comment longer than that is cut; the older ones that do not fit are counted.
 */
function renderComments(comments: { author: string; createdAt: string; body: string }[]): string[] {
  if (!comments.length) return [];
  const out = ["### Comments, newest first", ""];
  let used = 0;
  let shown = 0;
  for (const c of comments) {
    const body = c.body.trim();
    if (used + body.length > ISSUE_BODY_CHARS && shown > 0) break;
    const text = body.length > ISSUE_BODY_CHARS ? body.slice(0, ISSUE_BODY_CHARS) : body;
    out.push(`**${c.author}** (${c.createdAt.slice(0, 10)}):`, "", text, "");
    used += text.length;
    shown++;
  }
  const cut = comments.length - shown;
  if (cut) out.push(`(${cut} older ${cut === 1 ? "comment" : "comments"} cut at ${ISSUE_BODY_CHARS} characters)`, "");
  return out;
}

/** How big a plan may be, and what to do when the task needs more. */
function renderBudget({ files, steps, canSplit }: NonNullable<ContextPacket["budget"]>): string[] {
  return [
    "# Size budget",
    "",
    `Keep the plan to at most ${files} files in ownedPaths and ${steps} steps. A small plan is reviewed, built and merged faster, and conflicts less with other runs.`,
    "",
    canSplit
      ? "When the task needs more than that, do not plan all of it: return status `split` with parts, in the order they should be built. Give each part a title, a body that says what it builds and how a person checks it, and its ownedPaths. Say in plan why the task is split. The first part stays in this run; when a person accepts the split, handoff opens an issue for each later part, and you plan the first part again on its own."
      : "When the task needs more than that, plan all of it and say in plan why it is larger.",
    "",
  ];
}

const pathList = (paths: string[]) => (paths.length ? paths.map((p) => `\`${p}\``).join(", ") : "(nothing yet)");

/** The project's other active runs and handoff's open pull requests, with the files they own or change. */
function renderOtherWork({ runs, pulls }: OtherWork): string[] {
  if (!runs.length && !pulls.length) return [];
  const out = [
    "# Other work on this project",
    "",
    "Other runs change this repository at the same time. Plan around their files where the task allows: a file two runs change conflicts when the second one merges. When this task needs one of these files, say so in plan.",
    "",
  ];
  if (runs.length) {
    out.push("## Active runs", "");
    for (const r of runs) {
      const issues = r.issues.length ? r.issues.map((i) => `#${i.number} ${i.title}`).join(", ") : r.task.split("\n")[0]!.trim();
      out.push(`- \`${r.branch}\` (${issues}) owns ${pathList(r.ownedPaths)}`);
    }
    out.push("");
  }
  if (pulls.length) {
    out.push("## Open pull requests from handoff", "");
    out.push(...pulls.map((p) => `- #${p.number} on \`${p.branch}\` changes ${pathList(p.files)}`), "");
  }
  return out;
}

const PLAN_STAGE ="Stage: plan. No code exists for this run yet; review the plan in the run state and never ask for an implementation.";

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
  if (packet.stage === "plan") out.push("# Stage", "", PLAN_STAGE, "");
  if (packet.instructions) out.push("# Instructions for this step", "", packet.instructions, "");
  if (packet.earlierRun) out.push(...renderEarlierRun(packet.earlierRun));
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
      out.push(...renderComments(issue.comments ?? []));
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
      "After the walk-through, read the browser console with browser_console_messages, with level warning and all set to true. In console, list each error and warning with its level and text as the tool printed it. An error, such as an uncaught exception or an unhandled rejection, fails the demo; list it all the same.",
      "",
    );
  }
  if (packet.previousReview) {
    const { verdict, comments, reply, reviewedAt } = packet.previousReview;
    const since = reviewedAt ? ` (\`git diff ${reviewedAt}..HEAD\`)` : "";
    out.push(
      "# Your previous review",
      "",
      `You reviewed this work before and ${verdict === "approve" ? "approved it" : "sent it back"} with the findings below. For each one, check whether the changes since then handle it.`,
      "Repeat each finding that still holds, with its severity, and leave out the ones the changes fixed.",
      `Then look for new problems in the lines changed since your last review. A new finding on a line that did not change since${since} is follow_up unless it is blocking.`,
      "",
      "## Your findings",
      "",
      ...comments.map((c) => `- ${c.severity ? `[${c.severity}] ` : ""}${c.path ? `${placeOf(c)}: ` : ""}${c.body}`),
      "",
    );
    if (reply) out.push("## What was changed since", "", reply, "");
  }
  out.push("# Run state", "", "```json", JSON.stringify(packet.stateSlice, null, 2), "```", "");
  out.push("# Repository context", "", ...renderWorktree(packet.environment), "Relevant paths:", list(packet.repoPaths, "- (none specified)"), "");
  const notes = packet.environment?.agentNotes?.trim();
  if (notes) out.push("# About this project's environment", "", notes, "");
  if (packet.otherWork) out.push(...renderOtherWork(packet.otherWork));
  if (packet.budget) out.push(...renderBudget(packet.budget));
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
  if (packet.reviewItems?.length) out.push(...renderReviewItems(packet.reviewItems));
  return out.join("\n");
}

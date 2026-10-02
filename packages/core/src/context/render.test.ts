import { expect, test } from "vitest";
import { renderContextPacket } from "./render.ts";

const packet = {
  task: "Add a CHANGELOG.md",
  nodeKey: "coder",
  stateSlice: { plan: { steps: ["write file"] } },
  repoPaths: ["CHANGELOG.md"],
  constraints: { ownedPaths: ["CHANGELOG.md"], allowedTools: ["Read", "Edit"], maxTurns: 40 },
  outputContract: "coder_output",
};

test("renderContextPacket renders the fixed sections in order", () => {
  const md = renderContextPacket(packet);
  const headings = md.split("\n").filter((l) => l.startsWith("# "));
  expect(headings).toEqual(["# Task", "# Run state", "# Repository context", "# Constraints", "# Output contract"]);
  expect(md).toContain("Add a CHANGELOG.md");
  expect(md).toContain('"steps"');
  expect(md).toContain("coder_output");
});

test("the output contract asks for a short summary with a question, which notifications show", () => {
  const contract = renderContextPacket(packet).split("# Output contract")[1];
  expect(contract).toContain("return status `needs_input` with a question");
  expect(contract).toContain("`summary` of at most 80 characters");
});

test("renderContextPacket adds the previous attempt with failed check tails and unresolved review comments only", () => {
  const md = renderContextPacket({
    ...packet,
    priorAttempt: {
      summary: "tried once",
      failedChecks: [{ kind: "tests_green", passed: false, detail: "exit 1", logTail: Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n") }],
      reviewComments: [
        { author: "ann", path: "a.ts", line: 3, body: "rename this", resolved: false },
        { author: "bob", body: "old note", resolved: true },
      ],
    },
    humanAnswer: "Use ISO dates.",
    repairNote: "Retry with smaller diff.",
  });
  expect(md).toContain("# Previous attempt");
  expect(md).toContain("## Failed checks");
  expect(md).toContain("line 199");
  expect(md).not.toContain("line 100\n");
  expect(md).toContain("a.ts:3 - ann: rename this");
  expect(md).not.toContain("old note");
  expect(md).toContain("## Human answer");
  expect(md).toContain("## Operator note");
});

test("renderContextPacket lists linked issues after the task, with long bodies cut", () => {
  const md = renderContextPacket({
    ...packet,
    issues: [
      { number: 12, title: "Slugify drops digits", url: "https://github.com/o/r/issues/12", body: "Steps:\n1. slugify('2nd')" },
      { number: 14, title: "Long one", url: "https://github.com/o/r/issues/14", body: "x".repeat(10_000) },
    ],
  });
  const headings = md.split("\n").filter((l) => l.startsWith("# "));
  expect(headings.slice(0, 2)).toEqual(["# Task", "# Linked issues"]);
  expect(md).toContain("## #12 Slugify drops digits");
  expect(md).toContain("https://github.com/o/r/issues/12");
  expect(md).toContain("slugify('2nd')");
  expect(md).toContain("(issue body cut at 4000 characters)");
  expect(md.length).toBeLessThan(9_000);
});

test("a linked issue with a story and an epic renders Part of before its body, story first", () => {
  const md = renderContextPacket({
    ...packet,
    issues: [
      {
        number: 57,
        title: "Add the migration",
        url: "https://github.com/o/r/issues/57",
        body: "Add plan_project_number to projects.",
        lineage: [
          { kind: "story", number: 41, title: "Shaping with the assistant", body: "As a person I shape work with the assistant." },
          { kind: "epic", number: 12, title: "Project management", body: "Plan work on GitHub Projects." },
        ],
      },
    ],
  });
  const section = md.slice(md.indexOf("## #57 Add the migration"), md.indexOf("# Run state"));
  expect(section).toContain('Story #41 "Shaping with the assistant": As a person I shape work with the assistant.');
  expect(section).toContain('Epic #12 "Project management": Plan work on GitHub Projects.');
  const partOf = section.indexOf("Part of");
  expect(partOf).toBeGreaterThan(-1);
  expect(partOf).toBeLessThan(section.indexOf("Story #41"));
  expect(section.indexOf("Story #41")).toBeLessThan(section.indexOf("Epic #12"));
  expect(section.indexOf("Epic #12")).toBeLessThan(section.indexOf("Add plan_project_number to projects."));
});

test("a parent body longer than 4,000 characters is cut with a note", () => {
  const md = renderContextPacket({
    ...packet,
    issues: [
      {
        number: 57,
        title: "Add the migration",
        url: "https://github.com/o/r/issues/57",
        body: "Task body.",
        lineage: [{ kind: "story", number: 41, title: "Long story", body: `${"s".repeat(4_000)}TAIL` }],
      },
    ],
  });
  expect(md).toContain(`Story #41 "Long story": ${"s".repeat(4_000)}\n\n(story body cut at 4000 characters)`);
  expect(md).not.toContain("TAIL");
});

test("a step's instructions follow the task", () => {
  const md = renderContextPacket({ ...packet, instructions: "Review the plan, not code." });
  const headings = md.split("\n").filter((l) => l.startsWith("# "));
  expect(headings.slice(0, 2)).toEqual(["# Task", "# Instructions for this step"]);
  expect(md).toContain("Review the plan, not code.");
});

test("a person's comments on a quoted part of the plan are shown with the quote", () => {
  const md = renderContextPacket({
    ...packet,
    priorAttempt: { summary: "Sent back by gate via gate->planner.", failedChecks: [], reviewComments: [{ author: "person", quote: "Use a JSON file for storage", body: "Use SQLite instead.", resolved: false }] },
    humanAnswer: "changes: Close, a few fixes.",
  });
  expect(md).toContain("- person on \"Use a JSON file for storage\": Use SQLite instead.");
  expect(md).toContain("changes: Close, a few fixes.");
});

test("suggestions a reviewer left with an approval follow the person's decisions", () => {
  const md = renderContextPacket({
    ...packet,
    decisions: [{ gate: "gate", note: "Use SQLite.", comments: [] }],
    suggestions: [{ from: "reviewer", comments: [{ path: "docs/features.md", line: 14, body: "Keep the t3env schema empty." }, { body: "Say in the PR that db:seed fails until F04." }] }],
  });
  const headings = md.split("\n").filter((l) => l.startsWith("# "));
  expect(headings.indexOf("# Suggestions from reviewers")).toBe(headings.indexOf("# Decisions from the person reviewing this run") + 1);
  expect(md).toContain("- docs/features.md:14 - reviewer: Keep the t3env schema empty.");
  expect(md).toContain("- reviewer: Say in the PR that db:seed fails until F04.");
  expect(md).toMatch(/decisions from the person take precedence/i);
});

test("comments on lines of a file show the file and the line range", () => {
  const md = renderContextPacket({
    ...packet,
    decisions: [{ gate: "gate", comments: [{ path: "src/a.ts", line: 3, endLine: 5, quote: "const a = 1;", body: "Keep it." }, { path: "src/b.ts", line: 7, body: "Fine." }] }],
    priorAttempt: { failedChecks: [], reviewComments: [{ author: "person", path: "src/a.ts", line: 3, endLine: 5, quote: "const a =\n  1;", body: "Rename.", resolved: false }] },
  });
  expect(md).toContain('- src/a.ts:3-5 on "const a = 1;": Keep it.');
  expect(md).toContain("- src/b.ts:7: Fine.");
  expect(md).toContain('- src/a.ts:3-5 - person on "const a = 1;": Rename.');
});

test("the constraints tell agents to stop what they start and to keep off the dashboard's port", () => {
  const md = renderContextPacket(packet);
  expect(md).toContain("- If you start a server or a watcher, stop it before you finish. Do not use port 3000: the handoff dashboard runs there.");
});

test("the constraints say how to change a file outside the owned paths", () => {
  const md = renderContextPacket(packet);
  expect(md).toContain("If the change needs a file outside these, list it in extraPaths with the reason; any other file outside them fails the step.");
});

test("the constraints keep agents to the repository's commit conventions, without invented trailers", () => {
  expect(renderContextPacket(packet)).toContain("- Follow the repository's commit conventions. Add no trailers, such as Co-Authored-By, unless the repository asks for them.");
});

test("a reviewer's second look shows its earlier comments, the coder's reply, and the commits to look at", () => {
  const md = renderContextPacket({
    ...packet,
    previousReview: {
      comments: [{ path: "src/env.ts", line: 5, body: "Only checks the scheme." }, { body: "Say how to run it." }],
      reply: "Validated the host too, and added a README line.",
      reviewedAt: "4ef4f22",
    },
  });
  expect(md).toContain("# Your previous review");
  expect(md).toContain("- src/env.ts:5: Only checks the scheme.");
  expect(md).toContain("- Say how to run it.");
  expect(md).toContain("Validated the host too, and added a README line.");
  expect(md).toContain("git diff 4ef4f22..HEAD");
});

test("a later review gets the earlier findings after an approve verdict too", () => {
  const md = renderContextPacket({
    ...packet,
    previousReview: {
      verdict: "approve",
      comments: [
        { path: "src/env.ts", line: 5, body: "Name the constant.", severity: "should_fix" },
        { body: "Add a test for an empty list.", severity: "follow_up" },
      ],
      reviewedAt: "4ef4f22",
    },
  });
  expect(md).toContain("You reviewed this work before and approved it with the findings below.");
  expect(md).toContain("- [should_fix] src/env.ts:5: Name the constant.");
  expect(md).toContain("- [follow_up] Add a test for an empty list.");
  expect(md).toContain("Repeat each finding that still holds, with its severity, and leave out the ones the changes fixed.");
  expect(md).toContain("A new finding on a line that did not change since (`git diff 4ef4f22..HEAD`) is follow_up unless it is blocking.");
});

test("a reviewer before any coder has passed is told it reviews a plan and must not ask for code", () => {
  const md = renderContextPacket({ ...packet, nodeKey: "plan-review", outputContract: "reviewer_output", stage: "plan" });
  expect(md).toContain("Stage: plan. No code exists for this run yet; review the plan in the run state and never ask for an implementation.");
  expect(renderContextPacket({ ...packet, outputContract: "reviewer_output", stage: "code" })).not.toContain("Stage: plan.");
});

test("a conflict with main asks the coder to merge it in, keep both changes and leave lockfiles to the package manager", () => {
  const md = renderContextPacket({ ...packet, conflict: { base: "main", baseSha: "abc1234def", files: ["package.json", "pnpm-lock.yaml"] } });
  expect(md).toContain("# Merge conflict with main");
  expect(md).toContain("- package.json\n- pnpm-lock.yaml");
  expect(md).toContain("`git merge abc1234def`");
  expect(md).toContain("Lockfiles");
  expect(md).toContain("`git commit --no-edit`");
  expect(md).toContain("`extraPaths`");
  // It comes before the output contract, so it reads as the job, not an afterthought.
  expect(md.indexOf("# Merge conflict with main")).toBeLessThan(md.indexOf("# Output contract"));
});

test("the run's acceptance criteria follow the linked issues, saying where they came from", () => {
  const md = renderContextPacket({ ...packet, acceptance: { source: "planner", items: ["A user can create a new task", "Tasks persist after a reload"] } });
  const headings = md.split("\n").filter((l) => l.startsWith("# "));
  expect(headings.slice(0, 2)).toEqual(["# Task", "# Acceptance criteria"]);
  expect(md).toContain("- A user can create a new task\n- Tasks persist after a reload");
  expect(md).toContain("The planner wrote these");
  expect(renderContextPacket({ ...packet, acceptance: { source: "issue", items: ["x"] } })).toContain("The linked issues list these");
});

test("Earlier in this run lists allowed paths, notes and answers", () => {
  const md = renderContextPacket({
    ...packet,
    memory: {
      extraPaths: [{ path: "pnpm-workspace.yaml", reason: "pnpm reads build approvals only from this file", attempt: 1 }],
      notes: [{ note: "Use the date helper in src/dates.ts.", attempt: 2 }],
      answers: [{ question: "ISO dates or US dates?", answer: "Use ISO 8601 dates.", option: "ISO", attempt: 1 }],
    },
  });
  expect(md).toContain("# Earlier in this run");
  const earlier = md.split("# Earlier in this run")[1]!;
  expect(earlier).toContain("- `pnpm-workspace.yaml`: pnpm reads build approvals only from this file");
  expect(earlier).toContain("- Use the date helper in src/dates.ts.");
  expect(earlier).toContain('- "ISO dates or US dates?" ISO: Use ISO 8601 dates.');
  expect(renderContextPacket(packet)).not.toContain("# Earlier in this run");
});

test("the packet names the run's branch, whether setup ran, and the project's agent notes", () => {
  const md = renderContextPacket({
    ...packet,
    environment: { branch: "handoff/add-changelog-5a998648", setupCommand: "pnpm install --frozen-lockfile", agentNotes: "The database container is shared and already running." },
  });
  const repository = md.split("# Repository context")[1]!.split("\n# ")[0]!;
  expect(repository).toContain("on this run's branch, `handoff/add-changelog-5a998648`");
  expect(repository).toContain("Do not create or switch to another branch.");
  expect(repository).toContain("The project's setup command, `pnpm install --frozen-lockfile`, ran in this worktree before this step.");
  expect(repository).toContain("HANDOFF_RUN_SHORT");
  expect(md).toContain("# About this project's environment\n\nThe database container is shared and already running.");

  const bare = renderContextPacket({ ...packet, environment: { branch: "handoff/x", setupCommand: null } });
  expect(bare).toContain("The project has no setup command, so nothing was installed in this worktree");
  expect(bare).not.toContain("# About this project's environment");
});

test("the planner's packet has the size budget, the other active runs' owned paths, the open handoff PRs' files and the issue comments", () => {
  const long = "x".repeat(3_970);
  const md = renderContextPacket({
    ...packet,
    nodeKey: "planner",
    outputContract: "planner_output",
    budget: { files: 15, steps: 12, canSplit: true },
    otherWork: {
      runs: [{ runId: "r2", task: "Add tags", branch: "handoff/add-tags-1234abcd", issues: [{ number: 7, title: "Add tags" }], ownedPaths: ["src/tags.ts", "src/db/schema.ts"] }],
      pulls: [{ runId: "r3", task: "Dark mode", issues: [], number: 41, url: "https://github.com/octo/sample/pull/41", branch: "handoff/dark-mode-9f8e7d6c", files: ["src/theme.css", "src/app.tsx"] }],
    },
    issues: [
      {
        number: 12,
        title: "Add a board",
        url: "https://github.com/octo/sample/issues/12",
        body: "Show the todos as a board.",
        comments: [
          { author: "krister", createdAt: "2026-10-02T10:00:00Z", body: "Keep the list view too." },
          { author: "ann", createdAt: "2026-10-01T10:00:00Z", body: long },
          { author: "bob", createdAt: "2026-09-30T10:00:00Z", body: "The oldest comment." },
        ],
      },
    ],
  });

  const budget = md.split("# Size budget")[1]!.split("\n# ")[0]!;
  expect(budget).toContain("at most 15 files in ownedPaths and 12 steps");
  expect(budget).toContain("return status `split` with parts");

  const other = md.split("# Other work on this project")[1]!.split("\n# ")[0]!;
  expect(other).toContain("`handoff/add-tags-1234abcd` (#7 Add tags) owns `src/tags.ts`, `src/db/schema.ts`");
  expect(other).toContain("#41 on `handoff/dark-mode-9f8e7d6c` changes `src/theme.css`, `src/app.tsx`");

  const issue = md.split("## #12 Add a board")[1]!.split("\n# ")[0]!;
  expect(issue).toContain("### Comments, newest first");
  expect(issue.indexOf("Keep the list view too.")).toBeLessThan(issue.indexOf(long));
  // The comments have the same 4,000-character budget as a body: the oldest one no longer fits.
  expect(issue).not.toContain("The oldest comment.");
  expect(issue).toContain("(1 older comment cut at 4000 characters)");

  const unsplittable = renderContextPacket({ ...packet, budget: { files: 15, steps: 12, canSplit: false } });
  expect(unsplittable).toContain("# Size budget");
  expect(unsplittable).not.toContain("`split`");
  expect(renderContextPacket(packet)).not.toContain("# Size budget");
  expect(renderContextPacket(packet)).not.toContain("# Other work on this project");
});

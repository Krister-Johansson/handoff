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

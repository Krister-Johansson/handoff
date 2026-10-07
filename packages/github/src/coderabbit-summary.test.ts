import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { findCodeRabbitSummary, parseCodeRabbitSummary, summaryCoversHead } from "./coderabbit-summary.ts";
import type { IssueComment } from "./types.ts";

// Recorded from northMES/northmes summary comments on 2026-10-05, through the REST
// issue comments and the GraphQL edit history of each comment. The change stack
// link's scope token, the walkthrough's change tables and the architecture review's
// details are cut; every marker and the sections the parser reads are as recorded.
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/coderabbit/${name}`, import.meta.url), "utf8");
}

test("finds the summary comment by its first line among a pull request's comments", () => {
  // #208's comments: a person's review request, the summary, two of CodeRabbit's
  // replies to that request and an Autopilot notice, all by the same bot.
  const comments = JSON.parse(fixture("pr208-comments.json")) as IssueComment[];

  expect(findCodeRabbitSummary(comments)?.id).toBe(6000136492);
  expect(findCodeRabbitSummary(comments, { author: "coderabbitai" })?.id).toBe(6000136492);
  expect(findCodeRabbitSummary(comments, { author: "someone-else" })).toBeNull();
  expect(findCodeRabbitSummary(comments.filter((c) => c.id !== 6000136492))).toBeNull();
});

test("reads the covered commit from final_review_risk_coverage, else from change_assessment_commit", () => {
  expect(parseCodeRabbitSummary(fixture("pr208-reviewed.md")).coveredCommit).toBe("501f7d04e931a6c37c0711e4c548b2c55a3bfc80");
  expect(parseCodeRabbitSummary(fixture("pr192-reviewed.md")).coveredCommit).toBe("3467df93de28f06c124bca36031c5f63a6194b19");

  // Coverage says 94c0c and the change assessment says 501f7: coverage wins.
  const disagreeing = fixture("pr208-reviewed-again.md").replace(
    '<!-- change_assessment_commit:"94c0c6c82ff9dd2d62748249e5ad75a11c615908" -->',
    '<!-- change_assessment_commit:"501f7d04e931a6c37c0711e4c548b2c55a3bfc80" -->',
  );
  expect(parseCodeRabbitSummary(disagreeing).coveredCommit).toBe("94c0c6c82ff9dd2d62748249e5ad75a11c615908");

  const withoutCoverage = fixture("pr208-reviewed-again.md").replace(/<!-- final_review_risk_coverage:.*-->\n/, "");
  expect(parseCodeRabbitSummary(withoutCoverage).coveredCommit).toBe("94c0c6c82ff9dd2d62748249e5ad75a11c615908");

  // The first edit on #208 has neither: CodeRabbit had only started.
  expect(parseCodeRabbitSummary(fixture("pr208-first-pass.md")).coveredCommit).toBeNull();
});

test("a review in progress block marks the summary as not covering the head", () => {
  // At 18:12:37 on #208 CodeRabbit was reviewing 94c0c while the rest of the comment
  // still described its review of 501f7.
  const inProgress = parseCodeRabbitSummary(fixture("pr208-in-progress.md"));
  expect(inProgress).toMatchObject({
    coveredCommit: "501f7d04e931a6c37c0711e4c548b2c55a3bfc80",
    inProgress: true,
    reviewingCommit: "94c0c6c82ff9dd2d62748249e5ad75a11c615908",
  });
  expect(summaryCoversHead(inProgress, "501f7d04e931a6c37c0711e4c548b2c55a3bfc80")).toBe(false);
  expect(summaryCoversHead(inProgress, "94c0c6c82ff9dd2d62748249e5ad75a11c615908")).toBe(false);

  const reviewed = parseCodeRabbitSummary(fixture("pr208-reviewed.md"));
  expect(reviewed).toMatchObject({ inProgress: false, reviewingCommit: null });
  expect(summaryCoversHead(reviewed, "501f7d04e931a6c37c0711e4c548b2c55a3bfc80")).toBe(true);
  expect(summaryCoversHead(reviewed, "94c0c6c82ff9dd2d62748249e5ad75a11c615908")).toBe(false);

  expect(parseCodeRabbitSummary(fixture("pr208-first-pass.md"))).toMatchObject({
    inProgress: true,
    reviewingCommit: "501f7d04e931a6c37c0711e4c548b2c55a3bfc80",
  });
});

test("the paragraph after the coverage marker is a walkthrough note", () => {
  const summary = parseCodeRabbitSummary(fixture("pr208-reviewed.md"));
  const notes = summary.findings.filter((f) => f.kind === "summary_note");
  expect(notes).toEqual([
    {
      kind: "summary_note",
      id: expect.stringMatching(/^note:[0-9a-f]{16}$/),
      text: "The workflow still directs authors to link committed design images, but its explanation of the attachment limitation is inaccurate. Correct the rationale to reflect the repository’s commit-first requirement.",
    },
  ]);
  expect(summary.mergeRisk).toBe("Low");
  expect(summary.problems).toEqual([]);

  // The same note in a later edit of the comment keeps its id; a new note gets a new one.
  const sameNote = parseCodeRabbitSummary(fixture("pr208-in-progress.md")).findings.filter((f) => f.kind === "summary_note");
  expect(sameNote.map((n) => n.id)).toEqual([notes[0]!.id]);
  const nextReview = parseCodeRabbitSummary(fixture("pr208-reviewed-again.md"));
  expect(nextReview.findings.filter((f) => f.kind === "summary_note")).toEqual([
    { kind: "summary_note", id: expect.not.stringMatching(notes[0]!.id), text: "The updated design workflow guidance has no identified merge-blocking issue." },
  ]);
  expect(nextReview.mergeRisk).toBe("Minimal");

  // Two paragraphs are two notes, and whitespace does not change a note's id.
  const twoParagraphs = fixture("pr208-reviewed.md").replace(
    "commit-first requirement.\n",
    "commit-first\n   requirement.\n\nThe roadmap paths are unchanged.\n",
  );
  const two = parseCodeRabbitSummary(twoParagraphs).findings.filter((f) => f.kind === "summary_note");
  expect(two.map((n) => n.id)).toEqual([notes[0]!.id, expect.stringMatching(/^note:/)]);
  expect(two[1]).toMatchObject({ text: "The roadmap paths are unchanged." });
});

test("a failed check in warning mode is a finding with the explanation and resolution from its full details", () => {
  const summary = parseCodeRabbitSummary(fixture("pr208-reviewed.md"));
  expect(summary.findings.filter((f) => f.kind === "pre_merge_check")).toEqual([
    {
      kind: "pre_merge_check",
      id: "check:Title check",
      name: "Title check",
      status: "warning",
      // The table cell stops at "rather than an …"; the full details do not.
      explanation:
        "The title matches the documentation changes, but it does not meet the release-note rule. The `docs` type does not reach the changelog, and the description names repository organization rather than an outcome for users.",
      resolution:
        "If this change has a user-visible outcome, use a changelog type such as `feat`, `fix`, `security`, `perf`, or `revert` and state that outcome in the title. If it has no user-visible outcome, confirm that a release-note title is not required for this documentation-only change.",
    },
  ]);
  expect(summary.problems).toEqual([]);

  // On #192 the title check's full details hold only the resolution, since its
  // explanation fit in the table cell.
  const pr192 = parseCodeRabbitSummary(fixture("pr192-reviewed.md"));
  const checks = pr192.findings.filter((f) => f.kind === "pre_merge_check");
  expect(checks.map((c) => c.id)).toEqual(["check:Linked Issues check", "check:Title check"]);
  expect(checks[0]).toMatchObject({
    status: "warning",
    explanation: expect.stringContaining("the PR description confirms these files are absent"),
    resolution: expect.stringContaining("must be available for review if its contents are needed to establish that result."),
  });
  expect(checks[1]).toMatchObject({
    explanation:
      "The title describes the workspace setup, but it uses `chore`, which does not reach the changelog, and describes implementation work rather than an outcome for users.",
    resolution:
      "Replace the title with a changelog-eligible Conventional Commit type and state the concrete user-facing outcome. If this change has no user-facing outcome, confirm that infrastructure-only pull requests are exempt from the release-note title rule.",
  });
  expect(pr192.problems).toEqual([]);

  const asError = parseCodeRabbitSummary(fixture("pr208-reviewed.md").replace("| ⚠️ Warning |", "| ❌ Error   |"));
  expect(asError.findings.find((f) => f.kind === "pre_merge_check")).toMatchObject({ id: "check:Title check", status: "error" });
});

test("passed checks are not findings", () => {
  // #210 passed all six checks.
  const allPassed = parseCodeRabbitSummary(fixture("pr210-passed.md"));
  expect(allPassed.findings.filter((f) => f.kind === "pre_merge_check")).toEqual([]);
  expect(allPassed.problems).toEqual([]);

  // #208 failed one check and passed five.
  const names = parseCodeRabbitSummary(fixture("pr208-reviewed.md"))
    .findings.filter((f) => f.kind === "pre_merge_check")
    .map((f) => f.name);
  expect(names).toEqual(["Title check"]);
});

test("a section whose shape changed becomes one raw finding and a problem", () => {
  // The failed checks become a list instead of a table.
  const listed = fixture("pr208-reviewed.md").replace(
    /### ❌ Failed checks \(1 warning\)\n[\s\S]*?(?=<details>\n<summary>✅ Passed checks)/,
    "### ❌ Failed checks (1 warning)\n\n- Title check: the title does not meet the release-note rule.\n\n",
  );
  const checks = parseCodeRabbitSummary(listed);
  expect(checks.findings.filter((f) => f.kind !== "summary_note")).toEqual([
    {
      kind: "raw",
      id: expect.stringMatching(/^raw:pre_merge_checks:[0-9a-f]{16}$/),
      section: "pre_merge_checks",
      text: expect.stringContaining("- Title check: the title does not meet the release-note rule."),
    },
  ]);
  expect(checks.problems).toEqual([{ section: "pre_merge_checks", message: expect.any(String) }]);

  // The failed checks heading is renamed while the section's summary line still counts one.
  const renamed = parseCodeRabbitSummary(fixture("pr208-reviewed.md").replace("### ❌ Failed checks (1 warning)", "### ❌ Checks that need work"));
  expect(renamed.findings.map((f) => f.kind)).toEqual(["summary_note", "raw"]);
  expect(renamed.problems).toEqual([{ section: "pre_merge_checks", message: expect.any(String) }]);

  // The final review risk section loses its coverage marker, so nothing says where the notes start.
  const unmarked = fixture("pr208-reviewed.md").replace(/<!-- final_review_risk_coverage:.*-->\n/, "");
  const risk = parseCodeRabbitSummary(unmarked);
  expect(risk.findings.filter((f) => f.kind !== "pre_merge_check")).toEqual([
    {
      kind: "raw",
      id: expect.stringMatching(/^raw:final_review_risk:[0-9a-f]{16}$/),
      section: "final_review_risk",
      text: expect.stringContaining("Correct the rationale to reflect the repository’s commit-first requirement."),
    },
  ]);
  expect(risk.problems).toEqual([{ section: "final_review_risk", message: expect.any(String) }]);
  expect(risk.coveredCommit).toBe("501f7d04e931a6c37c0711e4c548b2c55a3bfc80");
});

test("a body without the markers yields no findings and a problem", () => {
  // CodeRabbit's reply to `@coderabbitai review` on #208, and a summary whose sections lost their markers.
  const reply = [
    "<!-- This is an auto-generated reply by CodeRabbit -->",
    "<details>",
    "<summary>⚠️ Action not completed</summary>",
    "",
    "Already reviewed the last commit. Use `@coderabbitai full review` to rerun a review of the entire changeset.",
    "",
    "</details>",
  ].join("\n");
  const unmarked = fixture("pr208-reviewed.md").replace(/<!-- (walkthrough|final_review_risk|pre_merge_checks_walkthrough)_(start|end) -->\n/g, "");

  for (const body of [reply, unmarked, ""]) {
    const summary = parseCodeRabbitSummary(body);
    expect(summary.findings).toEqual([]);
    expect(summary.problems).toEqual([{ section: "body", message: expect.any(String) }]);
    expect(summary.inProgress).toBe(false);
  }

  // A first pass that holds only a review in progress block is not a problem.
  expect(parseCodeRabbitSummary(fixture("pr208-first-pass.md")).problems).toEqual([]);
});

test("HTML entities in the summary's text are decoded once, so a finding holds plain text", () => {
  // Recorded from northMES/northmes#285 on 2026-10-07, at the summary's edit of 19:57. The Linked Issues
  // check's table cell has `&&`, but its full details block, which the parser prefers, has `&amp;&amp;`.
  const summary = parseCodeRabbitSummary(fixture("pr285-reviewed.md"));
  const [check] = summary.findings.filter((f) => f.kind === "pre_merge_check");
  expect(check).toMatchObject({ id: "check:Linked Issues check", status: "warning" });
  expect(check?.explanation).toContain("defines `check:full` as `pnpm check && pnpm test:tz`, so it has no e2e leg.");
  expect(summary.problems).toEqual([]);

  // The other common entities and numeric forms, in a note and in a check's full details. A decoded
  // `&amp;lt;` is `&lt;`, not `<`: one pass, never two.
  const encoded = "Use &lt;Suspense&gt; with &quot;fallback&quot;, don&#39;t nest it &#x2192; see &#8364;5 &amp; &#X40;b; &amp;lt; stays.";
  const plain = "Use <Suspense> with \"fallback\", don't nest it \u2192 see \u20ac5 & @b; &lt; stays.";
  const withEntities = fixture("pr208-reviewed.md")
    .replace("Correct the rationale to reflect the repository’s commit-first requirement.", encoded)
    .replace("rather than an outcome for users.\n", `rather than an outcome for users. ${encoded}\n`);
  const parsed = parseCodeRabbitSummary(withEntities);
  expect(parsed.findings.find((f) => f.kind === "summary_note")).toMatchObject({ text: expect.stringContaining(plain) });
  expect(parsed.findings.find((f) => f.kind === "pre_merge_check")).toMatchObject({ explanation: expect.stringContaining(plain) });
});

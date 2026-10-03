import linear from "@handoff/core/fixtures/linear.graph.json" with { type: "json" };
import { afterAll, beforeEach, expect, test } from "vitest";
import { questions } from "@handoff/db";
import { createTestDb, seedExecution, truncateAll } from "@handoff/db/testing";
import { FakeGitHub, FakeProjects } from "@handoff/github/testing";
import { createFollowUp } from "./follow-up.ts";
import { createProject, saveGraphVersion, startRunFromGraph } from "./graphs.ts";
import { getReview } from "./review.ts";
import { setupPlan } from "./shaping.ts";

const db = createTestDb();
const repo = { owner: "octo", name: "sample" };
let github: FakeGitHub;
let plan: FakeProjects;
let projectId: string;

beforeEach(async () => {
  await truncateAll(db);
  const project = await createProject(db, { name: "sandbox", repo: "octo/sample", defaultBranch: "main" });
  projectId = project.id;
  await saveGraphVersion(db, { projectId, name: "linear", document: linear });
  github = new FakeGitHub();
  github.issues.set(11, { number: 11, title: "Add a board", url: "https://github.com/octo/sample/issues/11", body: "Body", state: "open" });
  plan = new FakeProjects(github);
});
afterAll(() => db.$client.end());

const comments = [
  { path: "src/a.ts", line: 10, body: "Name the constant.", severity: "should_fix" },
  { path: "src/b.ts", line: 2, body: "Crashes on an empty list.", severity: "blocking" },
  { path: "docs/notes.md", body: "Link the ADR.", severity: "follow_up" },
];

/** A run on #11 waiting at its code review gate, after a code review with three findings. */
async function codeGate() {
  const run = await startRunFromGraph(db, { projectId, graphName: "linear", task: "Add a board", issues: [11] }, github);
  await seedExecution(db, run.id, { nodeKey: "review", nodeType: "code_review", status: "passed", output: { verdict: "request_changes", comments } });
  const gate = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [question] = await db
    .insert(questions)
    .values({ runId: run.id, nodeExecutionId: gate.id, question: "Review the code", context: { reason: "approval", review: { from: "review", kind: "code", markdown: "", files: [] } } })
    .returning();
  return { runId: run.id, questionId: question!.id };
}

test("with a plan, the follow-up issue is a sub-issue of the run's issue and holds the chosen findings", async () => {
  await setupPlan({ db, github, projects: plan }, projectId);
  const gate = await codeGate();
  const issue = await createFollowUp({ db, github, projects: plan }, { ...gate, findings: [0, 2] });

  const created = await github.getIssue(repo, issue.number, { parents: true });
  expect(issue.url).toBe(created.url);
  expect(created.title).toBe("Follow-up to #11: Add a board");
  expect(created.parents?.map((p) => p.number)).toEqual([11]);
  expect(created.body).toContain("Name the constant.");
  expect(created.body).toContain("`src/a.ts:10` (should fix)");
  expect(created.body).toContain("`docs/notes.md` (follow-up)");
  expect(created.body).not.toContain("Crashes on an empty list.");
  expect(plan.itemsOf(repo).get(issue.number)?.status).toBe("Shaping");

  // The review shows the issue with the findings it holds, and a second one is not opened.
  expect((await getReview(db, gate.runId, gate.questionId))!.followUp).toEqual({ ...issue, findings: [0, 2] });
  await expect(createFollowUp({ db, github, projects: plan }, { ...gate, findings: [1] })).rejects.toThrow(`#${issue.number}`);
});

test("without a plan, the follow-up issue is a plain issue that names the run's issue", async () => {
  const gate = await codeGate();
  await expect(createFollowUp({ db, github, projects: plan }, { ...gate, findings: [7] })).rejects.toThrow("Pick at least one finding");
  const issue = await createFollowUp({ db, github, projects: plan }, { ...gate, findings: [1] });

  const created = await github.getIssue(repo, issue.number, { parents: true });
  expect(created.parents).toEqual([]);
  expect(created.body).toContain("Follow-up to #11.");
  expect(created.body).toContain("Crashes on an empty list.");
});

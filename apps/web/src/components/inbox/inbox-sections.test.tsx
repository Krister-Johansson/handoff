import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { InboxProjectFilter, InboxSections } from "./inbox-sections";
import { narrowInbox, type InboxView } from "./inbox-view";

vi.mock("@/app/inbox/actions", () => ({ answerAction: vi.fn(), repairAction: vi.fn(), cancelAction: vi.fn(), resolveLoopAction: vi.fn() }));
const projectActions = vi.hoisted(() => ({ requestMergeAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/app/projects/actions", () => projectActions);

const todo = { projectId: "p1", projectName: "todooverkill" };
const sandbox = { projectId: "p2", projectName: "sandbox" };
const question = (id: string, project: typeof todo, review = false) => ({
  ...project,
  id,
  runId: `r-${id}`,
  task: `Task ${id}`,
  question: `Question ${id}?`,
  options: [],
  nodeKey: "gate",
  reason: review ? "approval" : "needs_input",
  context: review ? { review: { from: "planner", kind: "plan" } } : {},
  createdAt: new Date("2026-10-01T10:00:00Z"),
});

const view: InboxView = {
  reviews: [question("a", todo, true), question("b", todo, true)],
  questions: [question("c", sandbox)],
  failedRuns: [{ ...sandbox, runId: "r-f", task: "Broken", executionId: "x", nodeKey: "tester", attempt: 1, error: null, finishedAt: null }],
  stuckRuns: [],
  pullRequests: [{ ...todo, runId: "r-p", task: "Shell", executionId: "y", number: 61, url: null, ci: "success", branch: "handoff/4" }],
  readyToMerge: [],
};

test("the inbox shows each kind of work under its own heading with a count, and leaves out empty ones", () => {
  render(<InboxSections view={view} />);
  const sections = screen.getAllByRole("region");
  expect(sections.map((s) => within(s).getByRole("heading", { level: 2 }).textContent)).toEqual([
    "Reviews to open2",
    "Questions to answer1",
    "Runs that stopped1",
    "Pull requests waiting for your review1",
  ]);
  expect(within(sections[0]!).getAllByRole("link", { name: "Open the review" })).toHaveLength(2);
});

test("the inbox narrows to one project, and the filter counts each project's items", () => {
  render(<InboxProjectFilter view={view} current={undefined} />);
  expect(screen.getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
    ["All 5", "/inbox"],
    ["todooverkill 3", "/inbox?project=p1"],
    ["sandbox 2", "/inbox?project=p2"],
  ]);
  const narrowed = narrowInbox(view, "p2");
  expect([narrowed.reviews, narrowed.questions, narrowed.failedRuns, narrowed.pullRequests].map((g) => g.length)).toEqual([0, 1, 1, 0]);
  expect(narrowInbox(view, undefined)).toBe(view);
});

test("a pull request first in its project's merge queue can be merged from the inbox", async () => {
  render(<InboxSections view={{ ...view, readyToMerge: [{ ...todo, runId: "r-m", task: "F06 Test harness", prNumber: 54, issues: [] }] }} />);
  const group = screen.getByRole("region", { name: /Ready to merge/ });
  expect(group).toHaveTextContent("#54 F06 Test harness");
  fireEvent.click(within(group).getByRole("button", { name: "Merge" }));
  await waitFor(() => expect(projectActions.requestMergeAction).toHaveBeenCalledWith({ runId: "r-m", projectId: "p1" }));
});

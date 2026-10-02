import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { InboxProjectFilter, InboxSections } from "./inbox-sections";
import { narrowInbox, type InboxView } from "./inbox-view";

vi.mock("@/app/inbox/actions", () => ({ answerAction: vi.fn(), repairAction: vi.fn(), cancelAction: vi.fn(), resolveLoopAction: vi.fn(), answerPermissionAction: vi.fn() }));
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

test("permission requests come first, each with its run and the answers a person can give", () => {
  const request = { ...todo, id: "3f6b2a10-0000-4000-8000-000000000001", runId: "22222222-2222-4222-8222-222222222222", task: "#10 Projects in the sidebar", nodeKey: "coder-1", toolName: "Bash", input: { command: "git -C /w log" }, createdAt: new Date() };
  render(<InboxSections view={{ ...view, permissions: [request] }} />);
  const [first] = screen.getAllByRole("region");
  expect(within(first!).getByRole("heading", { level: 2 }).textContent).toBe("Permission requests1");
  expect(within(first!).getByRole("link", { name: "#10 Projects in the sidebar" })).toHaveAttribute("href", "/projects/p1/runs/22222222-2222-4222-8222-222222222222");
  expect(within(first!).getByRole("button", { name: "Allow once" })).toBeInTheDocument();
  expect(narrowInbox({ ...view, permissions: [request] }, "p2").permissions).toEqual([]);
});

test("every card carries the id its page tool refers to", () => {
  const permission = { ...todo, id: "perm-1", runId: "r-perm", task: "Permission task", nodeKey: "coder", toolName: "Bash", input: { command: "ls" }, createdAt: new Date() };
  const paths = { ...question("d", sandbox), reason: "paths", options: ["allow", "send_back", "fail"], context: { reason: "paths", from: "coder", files: ["notes.txt"] } };
  const tryIt = { ...question("e", sandbox), reason: "try", context: { reason: "try" } };
  render(
    <InboxSections
      view={{
        ...view,
        permissions: [permission],
        questions: [question("c", sandbox), paths, tryIt],
        readyToMerge: [{ ...todo, runId: "r-m", task: "Ready one", prNumber: 54, issues: [] }],
        stuckRuns: [{ ...sandbox, runId: "r-s", task: "Stuck one", nodeKey: "reviewer", loop: "reviewer->coder", attempts: 3, finishedAt: null }],
      }}
    />,
  );
  // A question or permission by its own id, a run waiting to merge or out of rounds by the run's, and a failed step or pull request by the execution's.
  const cards = [
    ["perm-1", "Permission task"],
    ["a", "Question a?"],
    ["b", "Question b?"],
    ["c", "Question c?"],
    ["d", "notes.txt"],
    ["e", "Question e?"],
    ["r-m", "Ready one"],
    ["x", "Broken"],
    ["r-s", "Stuck one"],
    ["y", "Shell"],
  ];
  for (const [id, text] of cards) {
    const card = document.getElementById(id!);
    expect(card, id).not.toBeNull();
    expect(card).toHaveAttribute("tabindex", "-1");
    expect(card).toHaveTextContent(text!);
  }
});

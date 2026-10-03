import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { FoundIssue, IssueRun } from "@/server/issue-page";
import { IssueView } from "./issue-view";
import { epicPage, NOW, PROJECT_REF, START, storyPage, taskPage, unplannedPage, waitingRun } from "./testing/issue-fixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/projects/p1/issues/16" }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), planIssueAction: vi.fn(), scheduleAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn() }));
vi.mock("@/app/projects/issue-actions", () => ({ assignAction: vi.fn(), assignableAction: vi.fn(), startIssueRunAction: vi.fn() }));
vi.mock("@/components/assistant/assistant-provider", () => ({ useOptionalAssistant: () => undefined }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/voice/voice-button", () => ({ VoiceButton: () => null }));
vi.mock("@/components/voice/voice-transcript", () => ({ VoiceTranscript: () => null }));

function show(page: FoundIssue, runs: IssueRun[] = []) {
  return render(<IssueView project={PROJECT_REF} page={page} runs={runs} start={START} now={NOW} readAt={NOW.getTime()} />);
}

const region = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });

test("a task's header says what it is, where it stands and who works on it", () => {
  show(taskPage(), [waitingRun()]);
  const header = screen.getByRole("banner", { name: "Task #16" });
  expect(within(header).getByRole("heading", { level: 1 })).toHaveTextContent("F16 Drag and drop on the board");
  expect(header).toHaveTextContent("Task");
  expect(within(header).getByText("Running")).toBeInTheDocument();
  expect(within(header).getByText("open")).toBeInTheDocument();
  expect(within(header).getByRole("link", { name: "#145" })).toHaveAttribute("href", "/projects/p1/issues/145");
  expect(within(header).getByText("projects-tasks")).toBeInTheDocument();
  expect(within(header).getByRole("button", { name: "Assignee: Krister-Johansson. Change assignees" })).toBeInTheDocument();
  expect(header).toHaveTextContent("assigned at Start run");
  expect(header).toHaveTextContent("Sep 30 to Oct 7");
  expect(header).toHaveTextContent("Opened by Krister-Johansson on Sep 30");
  expect(within(header).getByRole("link", { name: "Open on GitHub" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/todoOverKill/issues/16");
  // A running task offers no move; Schedule is on every plan item.
  expect(within(header).getByRole("button", { name: "Schedule" })).toBeInTheDocument();
  expect(within(header).queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
  expect(within(header).queryByRole("button", { name: "Back to Shaping" })).not.toBeInTheDocument();
});

test("a task leads with its runs: the step it is at, its steps so far, its branch and the review it waits on", () => {
  show(taskPage(), [waitingRun()]);
  const runs = region("Runs");
  const row = within(runs).getByRole("listitem", { name: /Run 64fde8ef/ });
  expect(row).toHaveTextContent("on master");
  expect(within(row).getByText("waiting")).toBeInTheDocument();
  expect(row).toHaveTextContent("human_gate-1 waits for your review");
  expect(within(row).getByText("Needs you")).toBeInTheDocument();
  expect(row).toHaveTextContent("2 h");
  expect(row).toHaveTextContent("started 14:08 UTC");
  expect(within(row).getByRole("list", { name: "Steps so far" })).toHaveTextContent("planner-1 ×3");
  expect(row).toHaveTextContent("handoff/16-f16-drag-and-drop-on-the-board-64fde8ef");
  expect(within(row).getByText("Review the plan from planner-1")).toBeInTheDocument();
  expect(within(row).getByRole("link", { name: "Open the review" })).toHaveAttribute("href", "/projects/p1/runs/64fde8ef-0000-4000-8000-000000000001/review/q1");
  expect(within(row).getByRole("link", { name: "Open run" })).toHaveAttribute("href", "/projects/p1/runs/64fde8ef-0000-4000-8000-000000000001");
});

test("the rail says where the task sits: its status and why a move is missing, its story and epic, its blockers open first, what it blocks and its pull request", () => {
  show(taskPage(), [waitingRun()]);
  const rail = screen.getByRole("complementary", { name: "Where #16 sits" });
  const plan = within(rail).getByRole("region", { name: "In the plan" });
  expect(plan).toHaveTextContent("Running");
  expect(within(plan).getByRole("link", { name: "handoff plan" })).toHaveAttribute("href", "https://github.com/users/o/projects/5");
  expect(plan).toHaveTextContent("Back to Shaping and Start run come back when run 64fde8ef ends. A running task keeps its status.");
  const partOf = within(rail).getByRole("region", { name: "Part of" });
  expect(within(partOf).getByRole("link", { name: "#132 Board interactions and subtask order" })).toHaveAttribute("href", "/projects/p1/issues/132");
  expect(within(partOf).getByRole("link", { name: "#121 Projects and tasks: finish Milestone 1" })).toHaveAttribute("href", "/projects/p1/issues/121");
  expect(partOf).toHaveTextContent("0 of 2 done");
  const blockedBy = within(rail).getByRole("region", { name: /Blocked by/ });
  expect(blockedBy).toHaveTextContent("1 open");
  expect(within(blockedBy).getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual(["/projects/p1/issues/145", "/projects/p1/issues/15", "/projects/p1/issues/8"]);
  expect(within(rail).getByRole("region", { name: "Blocks" })).toHaveTextContent("No issue waits for #16.");
  expect(within(rail).getByRole("region", { name: "Pull request" })).toHaveTextContent("None yet. The run's pull request shows here when it opens.");
});

test("a story leads with its tasks as in the Plan tree, shows its progress and epic, and offers Show in the plan", () => {
  show(storyPage());
  const header = screen.getByRole("banner", { name: "Story #132" });
  expect(header).toHaveTextContent("0 of 2 done");
  expect(within(header).getByRole("link", { name: "Show in the plan" })).toHaveAttribute("href", "/projects/p1/plan?epic=121");
  expect(within(header).getByRole("button", { name: "No assignee. Change assignees" })).toBeInTheDocument();
  // Stories get the picker only.
  expect(within(header).queryByRole("button", { name: "Assign me" })).not.toBeInTheDocument();
  const tasks = region("Tasks");
  const rows = within(tasks).getAllByRole("listitem");
  expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Task #16 F16 Drag and drop on the board, Running", "Task #88 F62 Reorder subtasks and show progress on board cards, Ready"]);
  expect(within(rows[0]!).getByRole("link", { name: "Needs you" })).toBeInTheDocument();
  expect(within(rows[1]!).getByRole("button", { name: "Back to Shaping" })).toBeInTheDocument();
  const rail = screen.getByRole("complementary", { name: "Where #132 sits" });
  expect(within(rail).getByRole("region", { name: "Progress" })).toHaveTextContent("0 of 2tasks done");
  expect(within(rail).getByRole("region", { name: "Progress" })).toHaveTextContent("GitHub counts 2 sub-issues, none closed.");
  expect(within(rail).getByRole("region", { name: "Part of" })).toHaveTextContent("Projects and tasks: finish Milestone 1");
  expect(within(rail).getByRole("region", { name: "Pull requests" })).toHaveTextContent("None of its tasks has a pull request yet.");
});

test("an epic shows its goal first, its stories collapsed with Expand all, its dates and what waits", () => {
  show(epicPage());
  const header = screen.getByRole("banner", { name: "Epic #121" });
  expect(header).toHaveTextContent("1 story, 2 tasks");
  expect(header).toHaveTextContent("Sep 28 to Oct 30");
  const stories = region("Stories and tasks");
  expect(within(stories).queryByRole("listitem", { name: /Task #16/ })).not.toBeInTheDocument();
  expect(within(stories).getByText("Blocked")).toBeInTheDocument();
  fireEvent.click(within(stories).getByRole("button", { name: "Expand all" }));
  expect(within(stories).getByRole("listitem", { name: /Task #16/ })).toBeInTheDocument();
  const rail = screen.getByRole("complementary", { name: "Where #121 sits" });
  expect(within(rail).getByRole("region", { name: "Dates" })).toHaveTextContent("TargetOct 30, in 28 days");
  const waiting = within(rail).getByRole("region", { name: "Waiting" });
  expect(waiting).toHaveTextContent("#16 needs you");
  expect(waiting).toHaveTextContent("2 of its 2 tasks wait on an open blocker. Closing these frees the most:");
  expect(within(waiting).getByRole("link", { name: "#145 R5 Restyle board columns and task cards" })).toHaveAttribute("href", "/projects/p1/issues/145");
  expect(waiting).toHaveTextContent("blocks 2");
});

test("a Flow project's task shows no Start and Target and offers no Schedule", () => {
  show(taskPage({ planMode: "flow" }), [waitingRun()]);
  const header = screen.getByRole("banner", { name: "Task #16" });
  expect(header).not.toHaveTextContent("Sep 30 to Oct 7");
  expect(within(header).queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();
  expect(header).toHaveTextContent("Opened by Krister-Johansson on Sep 30");
});

test("a Flow project's story shows no dates and offers Show in the plan without Schedule", () => {
  const page = storyPage();
  if (!page.place.planned || page.place.kind !== "story") throw new Error("not a story");
  show({ ...page, planMode: "flow", place: { ...page.place, item: { ...page.place.item, start: "2026-09-30", target: "2026-10-09" } } });
  const header = screen.getByRole("banner", { name: "Story #132" });
  expect(header).not.toHaveTextContent("Sep 30 to Oct 9");
  expect(within(header).queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();
  expect(within(header).getByRole("link", { name: "Show in the plan" })).toBeInTheDocument();
});

test("a Flow project's epic shows no dates in its header or rail and offers no Schedule; what waits stays", () => {
  show({ ...epicPage(), planMode: "flow" });
  const header = screen.getByRole("banner", { name: "Epic #121" });
  expect(header).not.toHaveTextContent("Sep 28 to Oct 30");
  expect(within(header).queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();
  const rail = screen.getByRole("complementary", { name: "Where #121 sits" });
  expect(within(rail).queryByRole("region", { name: "Dates" })).not.toBeInTheDocument();
  expect(within(rail).getByRole("region", { name: "Waiting" })).toHaveTextContent("#16 needs you");
});

test("a Timeline project's story and epic keep Schedule, their dates and the epic's Dates", () => {
  const { unmount } = show(storyPage());
  expect(within(screen.getByRole("banner", { name: "Story #132" })).getByRole("button", { name: "Schedule" })).toBeInTheDocument();
  unmount();
  show(epicPage());
  const header = screen.getByRole("banner", { name: "Epic #121" });
  expect(header).toHaveTextContent("Sep 28 to Oct 30");
  expect(within(header).getByRole("button", { name: "Schedule" })).toBeInTheDocument();
  expect(within(screen.getByRole("complementary", { name: "Where #121 sits" })).getByRole("region", { name: "Dates" })).toBeInTheDocument();
});

test("an issue outside the plan offers Plan it and Start run, says it is not in the plan, and that a cancelled run gave it back", () => {
  show(unplannedPage(), [waitingRun({ status: "cancelled", needsYou: false, waitingOn: null, assigned: null, line: { ...waitingRun().line, now: { tone: "muted", text: "Cancelled." } } })]);
  const header = screen.getByRole("banner", { name: "Issue #407" });
  expect(header).toHaveTextContent("unplanned");
  expect(header).toHaveTextContent("No labels");
  expect(within(header).getByRole("button", { name: "Plan it" })).toBeInTheDocument();
  expect(within(header).getByRole("button", { name: "Start run" })).toBeInTheDocument();
  expect(within(header).getByRole("button", { name: "Assign me" })).toBeInTheDocument();
  expect(region("Runs")).toHaveTextContent("A cancelled run gives the issue back to the backlog, so Start run is on.");
  const rail = screen.getByRole("complementary", { name: "Where #407 sits" });
  expect(within(rail).getByRole("region", { name: "In the plan" })).toHaveTextContent(
    "Not in the plan#407 is not an item of the GitHub Project handoff plan. Plan it adds it as a task in Shaping, under a story if you pick one.",
  );
  expect(within(rail).getByRole("region", { name: "Blocked by" })).toHaveTextContent("Nothing blocks #407.");
  expect(within(rail).getByRole("region", { name: "Pull request" })).toHaveTextContent("None yet.");
  expect(region("Comments")).toHaveTextContent("No comments on GitHub yet.");
});

test("a closed issue outside the plan offers neither Plan it nor Start run", () => {
  const page = unplannedPage();
  show({ ...page, issue: { ...page.issue, state: "closed", stateReason: "completed" } });
  const header = screen.getByRole("banner", { name: "Issue #407" });
  expect(header).toHaveTextContent("closed");
  expect(within(header).queryByRole("button", { name: "Plan it" })).not.toBeInTheDocument();
  expect(within(header).queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
});

test("the description renders the body with its references as issue pages, and the comments come from GitHub with their author and role", () => {
  show(taskPage(), [waitingRun()]);
  const description = region("Description");
  expect(within(description).getByRole("link", { name: "#15" })).toHaveAttribute("href", "/projects/p1/issues/15");
  expect(within(description).getByRole("link", { name: "Edit on GitHub" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/todoOverKill/issues/16");
  const comments = region("Comments");
  expect(within(comments).getByRole("link", { name: "Comment on GitHub" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/todoOverKill/issues/16#new_comment_field");
  const comment = within(comments).getByRole("article");
  expect(comment).toHaveTextContent("Krister-Johansson");
  expect(comment).toHaveTextContent("owner");
  expect(comment).toHaveTextContent("Oct 1, 22:17 UTC");
  expect(comment).toHaveTextContent("Notes from the code review of F15.");
  expect(within(comment).getByRole("link", { name: "Open this comment on GitHub" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/todoOverKill/issues/16#issuecomment-1");
});

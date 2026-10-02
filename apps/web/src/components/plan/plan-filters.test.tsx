import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { filterPlan, parsePlanFilters } from "@/lib/plan/filters";
import { PlanBoard } from "./plan-board";
import { PlanFilters } from "./plan-filters";
import { PlanTree } from "./plan-tree";
import { epic, planView, PROJECT, REPO_URL, run, story, task, unplannedIssue } from "./testing/plan-fixtures";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn() }));

beforeEach(() => router.replace.mockClear());

const view = planView(
  [
    epic(12, "Project management", [
      story(40, "Read the plan", 12, [task(52, "Projects port", "Done", { state: "closed" })]),
      story(41, "Shaping", 12, [
        task(54, "Status writes", "In review", { run: run("r4", "waiting", 88) }),
        task(55, "Shaping tools", "Running", { run: run("r5", "running") }),
        task(56, "Approval cards", "Running", { run: run("r6", "waiting") }),
        task(57, "Add the migration", "Shaping"),
      ]),
    ]),
    epic(10, "Voice", [story(18, "Voice settings", 10, [task(70, "Speak replies", "Running", { run: run("r7", "running") })])]),
  ],
  { unplanned: [unplannedIssue(301, "Worker restarts")] },
);
const needsYou = ["r6"];
const ctx = { projectId: "p1", repoUrl: REPO_URL, needsYou, graphs: ["loop"], graphName: "loop" };

function filters(params: Record<string, string>) {
  const parsed = parsePlanFilters(params);
  return { parsed, narrowed: filterPlan(view, parsed, needsYou) };
}

test("epic, status and run filters live in the URL and narrow both views", () => {
  const { parsed } = filters({});
  const { unmount } = render(<PlanFilters projectId="p1" view="board" filters={parsed} epics={view.epics} counts={{ Shaping: 1, Ready: 0, Running: 3, "In review": 1, Done: 1, Other: 0 }} unplanned={1} />);
  fireEvent.click(screen.getByRole("button", { name: "Epic All" }));
  fireEvent.click(screen.getByRole("option", { name: /#12 Project management/ }));
  expect(router.replace).toHaveBeenLastCalledWith("/projects/p1/plan?view=board&epic=12", { scroll: false });

  fireEvent.click(screen.getByRole("button", { name: "Run Any" }));
  fireEvent.click(screen.getByRole("radio", { name: /Needs you/ }));
  expect(router.replace).toHaveBeenLastCalledWith("/projects/p1/plan?view=board&run=needs-you", { scroll: false });
  unmount();

  // Two filters set: the Status popover adds to the picked statuses, and the chips undo each filter.
  const set = filters({ epic: "12", status: "Running" }).parsed;
  render(<PlanFilters projectId="p1" view="tree" filters={set} epics={view.epics} counts={{ Shaping: 1, Ready: 0, Running: 3, "In review": 1, Done: 1, Other: 0 }} unplanned={1} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Status Running" }), { key: "Enter" });
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /In review/ }));
  expect(router.replace).toHaveBeenLastCalledWith("/projects/p1/plan?epic=12&status=Running,In%20review", { scroll: false });
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  const chips = screen.getByRole("list", { name: "Filters" });
  expect(within(chips).getByRole("link", { name: "Remove Epic: Project management" })).toHaveAttribute("href", "/projects/p1/plan?status=Running");
  expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/projects/p1/plan");

  // Narrowed by epic 12 and Running or In review: the tree keeps the matching tasks, the board the same.
  const { narrowed } = filters({ epic: "12", status: "Running,In review" });
  const { container } = render(<PlanTree {...ctx} epics={narrowed.epics} unparented={narrowed.unparented} unplanned={narrowed.unplanned} hidden={narrowed.hidden} />);
  const tree = within(container);
  expect(tree.getAllByRole("treeitem", { name: /^Task/ }).map((r) => r.getAttribute("aria-label"))).toEqual([
    "Task #54 Status writes, In review",
    "Task #55 Shaping tools, Running",
    "Task #56 Approval cards, Running",
  ]);
  expect(tree.queryByRole("treeitem", { name: /Story #40/ })).not.toBeInTheDocument();
  expect(tree.queryByRole("treeitem", { name: /Epic #10/ })).not.toBeInTheDocument();
  expect(tree.queryByRole("treeitem", { name: /Unplanned/ })).not.toBeInTheDocument();
  expect(tree.getByText("2 more tasks in this epic do not match the filters.")).toBeInTheDocument();
  expect(within(tree.getByRole("treeitem", { name: /Epic #12/ })).getAllByText("1 of 5 done")).toHaveLength(1);

  const board = render(<PlanBoard {...ctx} project={PROJECT} board={narrowed.board} epics={view.epics} now={Date.parse("2026-10-02T12:00:00Z")} />);
  const running = within(board.getByRole("region", { name: "Running" }));
  expect(running.getAllByRole("listitem").map((c) => c.getAttribute("aria-label"))).toEqual(["#55 Shaping tools", "#56 Approval cards"]);
  expect(within(board.getByRole("region", { name: "Shaping" })).queryByRole("listitem")).not.toBeInTheDocument();

  // Needs you keeps only the task whose run waits on a person; Unplanned keeps only the unplanned block.
  expect(filters({ run: "needs-you" }).narrowed.board.Running.map((t) => t.number)).toEqual([56]);
  const unplannedOnly = filters({ epic: "unplanned" }).narrowed;
  expect([unplannedOnly.epics.length, unplannedOnly.unplanned.map((i) => i.number)]).toEqual([0, [301]]);
});

import { render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parsePlanFilters } from "@/lib/plan/filters";
import { PlanTab } from "./plan-tab";
import { epic, milestone, planView, story, task, timelineOf, withMilestones } from "./testing/plan-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn(), setupPlanAction: vi.fn() }));
vi.mock("@/app/projects/scheduler-actions", () => ({ switchToProjectOrderAction: vi.fn() }));

const render = (ui: ReactElement) => rtlRender(<TooltipProvider>{ui}</TooltipProvider>);

const READ_AT = Date.parse("2026-10-02T12:00:00Z");
const view = planView([epic(12, "Project management", [story(41, "Shaping", 12, [task(57, "Add the migration", "Ready"), task(58, "Plan page", "Shaping")])])]);
const props = {
  project: { id: "p1", name: "handoff", repoOwner: "o", repoName: "r" },
  plan: view,
  view: "tree" as const,
  filters: parsePlanFilters({}),
  signals: { needsYou: [], skipped: {} },
  start: { graphs: ["loop"], graphName: "loop" },
  readAt: READ_AT,
};

test("the activity line shows the latest issues, sub_issues or issue_dependencies delivery for the repository", () => {
  const { unmount } = render(
    <PlanTab {...props} activity={{ event: "issues", action: "closed", issue: 57, summary: "Issue #57 closed", receivedAt: new Date(READ_AT - 3 * 60_000) }} />,
  );
  expect(screen.getByText("Last from GitHub: Issue #57 closed, 3 minutes ago")).toBeInTheDocument();
  expect(within(screen.getByRole("tree")).getByRole("treeitem", { name: /Task #57/ })).toBeInTheDocument();
  unmount();

  render(<PlanTab {...props} activity={null} />);
  expect(screen.queryByText(/Last from GitHub/)).not.toBeInTheDocument();
});

test("every task, story and epic title on the tree, the board and the timeline links to its issue page; Open on GitHub stays in the row menu", () => {
  const { unmount } = render(<PlanTab {...props} activity={null} />);
  const tree = screen.getByRole("tree");
  expect(within(tree).getByRole("link", { name: "#57 Add the migration" })).toHaveAttribute("href", "/projects/p1/issues/57");
  expect(within(tree).getByRole("link", { name: "#41 Shaping" })).toHaveAttribute("href", "/projects/p1/issues/41");
  expect(within(tree).getByRole("link", { name: "#12 Project management" })).toHaveAttribute("href", "/projects/p1/issues/12");
  unmount();

  const board = render(<PlanTab {...props} view="board" activity={null} />);
  expect(screen.getByRole("link", { name: "#57 Add the migration" })).toHaveAttribute("href", "/projects/p1/issues/57");
  board.unmount();

  const plan = { ...view, timeline: timelineOf(view, [], new Date(READ_AT)) };
  render(<PlanTab {...props} plan={plan} view="timeline" zoom="months" activity={null} />);
  const grid = screen.getByRole("grid", { name: "Timeline" });
  expect(within(grid).getByRole("link", { name: "#57 Add the migration" })).toHaveAttribute("href", "/projects/p1/issues/57");
});

test("the timeline view shows the chart narrowed by the filters, and says so when nothing matches", () => {
  const plan = { ...view, timeline: timelineOf(view, [], new Date(READ_AT)) };
  const { unmount } = render(<PlanTab {...props} plan={plan} view="timeline" zoom="months" filters={parsePlanFilters({ status: "Ready" })} activity={null} />);
  expect(screen.getByRole("radio", { name: "Timeline" })).toHaveAttribute("aria-checked", "true");
  const grid = screen.getByRole("grid", { name: "Timeline" });
  expect(within(grid).getByRole("row", { name: "Task #57 Add the migration" })).toBeInTheDocument();
  expect(within(grid).queryByRole("row", { name: "Task #58 Plan page" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("radiogroup", { name: "Zoom" })).getByRole("radio", { name: "Months" })).toHaveAttribute("aria-checked", "true");
  unmount();

  render(<PlanTab {...props} plan={plan} view="timeline" zoom={undefined} filters={parsePlanFilters({ status: "Done" })} activity={null} />);
  expect(screen.getByText("No items match these filters")).toBeInTheDocument();
  for (const clear of screen.getAllByRole("link", { name: "Clear filters" })) expect(clear).toHaveAttribute("href", "/projects/p1/plan?view=timeline");
});

test("the open milestones sit above the toolbar in every view, and a milestone in the filter narrows the plan to its tasks", () => {
  const plain = planView([
    epic(12, "Project management", [story(41, "Shaping", 12, [task(57, "Add the migration", "Ready"), task(58, "Plan page", "Shaping", { milestone: { number: 2, title: "1.0" } })])], [], {
      milestone: { number: 1, title: "0.9" },
    }),
    epic(10, "Voice", [story(18, "Settings", 10, [task(70, "Speak", "Ready")])]),
  ]);
  const marked = withMilestones(plain, [milestone(1, "0.9", { dueOn: "2026-10-20" }), milestone(2, "1.0")]);
  for (const v of ["tree", "board"] as const) {
    const { unmount } = render(<PlanTab {...props} plan={marked} view={v} activity={null} />);
    const strip = screen.getByRole("region", { name: "Milestones" });
    expect(strip.compareDocumentPosition(screen.getByRole("radiogroup", { name: "View" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Progress counts tasks only: epic #12 and story #41 are in 0.9 too, and #58 is in 1.0.
    expect(within(strip).getByRole("button", { name: /^Milestone 0\.9/ })).toHaveTextContent("0 of 1 tasks done");
    expect(within(strip).getByRole("button", { name: /^Tasks in no milestone/ })).toHaveTextContent("1 open task");
    unmount();
  }

  render(<PlanTab {...props} plan={marked} view="tree" filters={parsePlanFilters({ milestone: "1" })} activity={null} />);
  expect(screen.getByRole("button", { name: /^Milestone 0\.9.*Showing only this milestone$/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Milestone 0.9" })).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Filters" })).getByRole("link", { name: "Remove Milestone: 0.9" })).toHaveAttribute("href", "/projects/p1/plan?view=tree");
  const tree = screen.getByRole("tree");
  expect(within(tree).getAllByRole("treeitem", { name: /^Task/ }).map((r) => r.getAttribute("aria-label"))).toEqual(["Task #57 Add the migration, Ready"]);
});

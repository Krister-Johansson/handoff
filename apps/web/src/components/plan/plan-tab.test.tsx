import { render as rtlRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parsePlanFilters } from "@/lib/plan/filters";
import { PlanTab } from "./plan-tab";
import { epic, planView, story, task, timelineOf } from "./testing/plan-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn(), setupPlanAction: vi.fn() }));

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

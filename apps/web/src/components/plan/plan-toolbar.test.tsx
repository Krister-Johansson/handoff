import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parsePlanFilters } from "@/lib/plan/filters";
import { PlanTab } from "./plan-tab";
import { epic, planView, run, story, task, timelineOf, unplannedIssue } from "./testing/plan-fixtures";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn(), scheduleAction: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const READ_AT = Date.parse("2026-10-02T12:00:00Z");
const view = planView(
  [
    epic(12, "Project management", [
      story(40, "Read the plan from GitHub", 12, [task(52, "Projects port", "Done", { state: "closed" }), task(53, "Plan read model", "Done", { state: "closed", assignees: ["krister"] })]),
      story(41, "Shaping with the assistant", 12, [
        task(55, "Shaping tools", "Running", { run: run("r5", "running"), assignees: ["krister"] }),
        task(56, "Approval cards", "Running", { assignees: ["example-dev"] }),
        task(57, "Add the migration", "Shaping", { blockedBy: [55] }),
        task(58, "Plan page tree and board", "Ready", { assignees: ["krister"] }),
      ]),
    ]),
    epic(10, "Voice", [story(18, "Voice settings", 10, [task(72, "Picker with local voices first", "Ready")])]),
  ],
  { unplanned: [unplannedIssue(301, "Worker restarts")] },
);
const plan = { ...view, timeline: timelineOf(view, [], new Date(READ_AT)) };

type Props = ComponentProps<typeof PlanTab>;
function renderTab(over: Partial<Props> = {}) {
  const props: Props = {
    project: { id: "p1", name: "handoff", repoOwner: "o", repoName: "r" },
    plan,
    view: "tree",
    filters: parsePlanFilters({}),
    signals: { needsYou: [], skipped: {} },
    start: { graphs: ["loop"], graphName: "loop" },
    readAt: READ_AT,
    activity: null,
    ...over,
  };
  return render(
    <TooltipProvider>
      <PlanTab {...props} />
    </TooltipProvider>,
  );
}

test("an unset filter shows only its name, a set one its value, and Assignee offers Anyone, Me, Unassigned and the people in the plan", () => {
  const { unmount } = renderTab({ me: "krister" });
  for (const name of ["Epic", "Status", "Run", "Assignee"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
  const options = within(screen.getByRole("radiogroup", { name: "Assignee" })).getAllByRole("radio");
  expect(options.map((o) => document.querySelector(`label[for="${o.id}"]`)?.textContent)).toEqual(["Anyone", "Me", "Unassigned", "example-dev"]);
  fireEvent.click(screen.getByRole("radio", { name: "Unassigned" }));
  expect(router.replace).toHaveBeenLastCalledWith("/projects/p1/plan?assignee=none", { scroll: false });
  unmount();

  renderTab({ filters: parsePlanFilters({ epic: "12", assignee: "me" }), me: "krister" });
  expect(screen.getByRole("button", { name: "Epic Project management" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Assignee Me" })).toBeInTheDocument();
  // Me keeps #55 and #58 (and Done #53) under epic #12.
  const tree = screen.getByRole("tree");
  expect(within(tree).getByRole("treeitem", { name: /Task #58/ })).toBeInTheDocument();
  expect(within(tree).queryByRole("treeitem", { name: /Task #56/ })).not.toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Filters" })).getByRole("link", { name: "Remove Assignee: Me" })).toHaveAttribute("href", "/projects/p1/plan?epic=12");
});

test("without a token user the Assignee filter has no Me", () => {
  renderTab();
  fireEvent.click(screen.getByRole("button", { name: "Assignee" }));
  const group = screen.getByRole("radiogroup", { name: "Assignee" });
  expect(within(group).queryByRole("radio", { name: "Me" })).not.toBeInTheDocument();
  expect(within(group).getByRole("radio", { name: "krister" })).toBeInTheDocument();
});

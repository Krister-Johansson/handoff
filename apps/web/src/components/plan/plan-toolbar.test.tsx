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

const searchBox = () => screen.getByRole("searchbox", { name: "Search the plan" });
const treeRow = (name: RegExp) => within(screen.getByRole("tree")).getByRole("treeitem", { name });
const collapsedRows = () => JSON.parse(localStorage.getItem("handoff.plan.collapsed.p1") ?? "[]") as string[];

test("searching #58 keeps the task with its story and epic open, marks the match, counts it and writes ?q= after a pause", () => {
  localStorage.setItem("handoff.plan.collapsed.p1", JSON.stringify(["e12", "s41"]));
  const replaceState = vi.spyOn(window.history, "replaceState");
  vi.useFakeTimers();
  renderTab();
  expect(screen.queryByRole("treeitem", { name: /Task #58/ })).not.toBeInTheDocument();

  fireEvent.change(searchBox(), { target: { value: "#58" } });
  expect(treeRow(/Epic #12/)).toHaveAttribute("aria-expanded", "true");
  expect(treeRow(/Story #41/)).toHaveAttribute("aria-expanded", "true");
  expect(within(treeRow(/Task #58/)).getByText("#58", { selector: "mark" })).toBeInTheDocument();
  expect(screen.queryByRole("treeitem", { name: /Task #57/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("treeitem", { name: /Epic #10/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("treeitem", { name: /Unplanned/ })).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 match");
  expect(screen.getByText("5 more tasks in this epic do not match the search.")).toBeInTheDocument();
  // The search opens rows for itself; the rows a person collapsed stay collapsed in the store.
  expect(collapsedRows()).toEqual(["e12", "s41"]);

  expect(replaceState).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(150));
  expect(replaceState).toHaveBeenLastCalledWith(null, "", "/projects/p1/plan?q=%2358");

  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(searchBox()).toHaveValue("");
  expect(treeRow(/Epic #12/)).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  act(() => vi.advanceTimersByTime(150));
  expect(replaceState).toHaveBeenLastCalledWith(null, "", "/projects/p1/plan");
  replaceState.mockRestore();
});

test("the search starts from ?q=, says when nothing matches, and the board shows No match in its empty columns", () => {
  const { unmount } = renderTab({ filters: parsePlanFilters({ q: "deploy" }) });
  expect(searchBox()).toHaveValue("deploy");
  expect(screen.getByRole("status")).toHaveTextContent("No match");
  expect(screen.getByText('No match for "deploy"')).toBeInTheDocument();
  expect(screen.getByText("Search looks at the numbers and titles of epics, stories, tasks and unplanned issues.")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Clear search" })).toHaveLength(2);
  unmount();

  renderTab({ view: "board", filters: parsePlanFilters({ q: "voice" }) });
  // A card shows when its task, its story or its epic matches.
  expect(within(screen.getByRole("region", { name: "Ready" })).getAllByRole("listitem").map((c) => c.getAttribute("aria-label"))).toEqual(["#72 Picker with local voices first"]);
  expect(within(screen.getByRole("region", { name: "Running" })).getByText("No match")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 match");
});

test("/ focuses the search; Escape clears it, then moves to the tree; Enter goes to the first match and Escape there keeps it in view", () => {
  localStorage.setItem("handoff.plan.collapsed.p1", JSON.stringify(["e12", "s41"]));
  renderTab();
  fireEvent.keyDown(document.body, { key: "/" });
  expect(searchBox()).toHaveFocus();

  fireEvent.change(searchBox(), { target: { value: "voice" } });
  fireEvent.keyDown(searchBox(), { key: "Escape" });
  expect(searchBox()).toHaveValue("");
  expect(searchBox()).toHaveFocus();
  fireEvent.keyDown(searchBox(), { key: "Escape" });
  expect(treeRow(/Epic #12/)).toHaveFocus();

  fireEvent.change(searchBox(), { target: { value: "#58" } });
  fireEvent.keyDown(searchBox(), { key: "Enter" });
  expect(treeRow(/Task #58/)).toHaveFocus();

  // Escape on a row clears the search, keeps focus there, and saves its epic and story open.
  fireEvent.keyDown(treeRow(/Task #58/), { key: "Escape" });
  expect(searchBox()).toHaveValue("");
  expect(treeRow(/Task #58/)).toHaveFocus();
  expect(collapsedRows()).toEqual([]);
});

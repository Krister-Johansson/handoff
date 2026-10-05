import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { PlanMilestone } from "@/lib/plan/milestones";
import { parsePlanFilters } from "@/lib/plan/filters";
import { MilestoneStrip } from "./milestone-strip";
import { milestone } from "./testing/plan-fixtures";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

beforeEach(() => router.replace.mockClear());

const byStatus = (over: Partial<PlanMilestone["progress"]["byStatus"]> = {}) => ({ Shaping: 0, Ready: 0, Running: 0, "In review": 0, Done: 0, Other: 0, ...over });

/** The design's Timeline milestones: Redesign beta ends a day late with #152 undated, Redesign 1.0 three days early, and a closed one. */
const timelineMilestones: PlanMilestone[] = [
  {
    ...milestone(1, "Redesign beta", { dueOn: "2026-10-03" }),
    progress: { done: 1, total: 12, byStatus: byStatus({ Done: 1, Running: 1, Ready: 1, Shaping: 9 }), timeline: { ends: "2026-10-04", daysPastDue: 1, undated: [152] } },
  },
  {
    ...milestone(2, "Redesign 1.0", { dueOn: "2026-10-16" }),
    progress: { done: 0, total: 6, byStatus: byStatus({ Shaping: 6 }), timeline: { ends: "2026-10-13", daysPastDue: -3, undated: [] } },
  },
  { ...milestone(3, "Alpha", { dueOn: "2026-09-01", state: "closed" }), progress: { done: 4, total: 4, byStatus: byStatus({ Done: 4 }), timeline: { ends: "2026-08-30", daysPastDue: -2, undated: [] } } },
];

const flowMilestones: PlanMilestone[] = [
  {
    ...milestone(4, "0.9", { dueOn: "2026-10-20" }),
    progress: { done: 2, total: 11, byStatus: byStatus({ Done: 2, "In review": 1, Running: 2, Ready: 6 }), flow: { last: { issue: 62, place: 6 }, skipped: [63] } },
  },
  { ...milestone(5, "1.0", { dueOn: "2026-11-30" }), progress: { done: 0, total: 7, byStatus: byStatus({ Ready: 2, Shaping: 5 }), flow: { last: { issue: 90, place: 13 }, skipped: [] } } },
];

const none = { done: 1, total: 5, byStatus: byStatus({ Done: 1, Ready: 4 }) };

test("the strip shows the open milestones with the due date, tasks done of total and when the Timeline ends them, then No milestone", () => {
  render(<MilestoneStrip projectId="p1" repo="o/r" view="timeline" mode="timeline" filters={parsePlanFilters({})} milestones={timelineMilestones} none={none} />);
  const strip = screen.getByRole("region", { name: "Milestones" });
  expect(within(strip).getByRole("link", { name: "Milestones on GitHub" })).toHaveAttribute("href", "https://github.com/o/r/milestones");
  const cards = within(strip).getAllByRole("button");
  // The closed milestone is not in the strip; it waits under Closed in the filter.
  expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual([
    "Milestone Redesign beta, due Oct 3, 1 of 12 tasks done, ends Oct 4, 1 day late, #152 has no dates",
    "Milestone Redesign 1.0, due Oct 16, 0 of 6 tasks done, ends Oct 13, 3 days early",
    "Tasks in no milestone, 4 open",
  ]);
  const [beta, release, nothing] = cards as [HTMLElement, HTMLElement, HTMLElement];
  expect(beta).toHaveTextContent("Redesign beta");
  expect(beta).toHaveTextContent("Due Oct 3");
  expect(beta).toHaveTextContent("1 of 12 tasks done");
  expect(within(beta).getByText("Ends Oct 4, 1 day late")).toHaveAttribute("data-tone", "late");
  expect(within(beta).getByText("#152 has no dates")).toBeInTheDocument();
  expect(within(beta).getByRole("img", { name: "1 Done, 1 Running, 1 Ready, 9 Shaping" })).toBeInTheDocument();
  expect(within(release).getByText("Ends Oct 13, 3 days early")).toHaveAttribute("data-tone", "ok");
  expect(nothing).toHaveTextContent("4 open tasks");
  expect(nothing).toHaveTextContent("Tasks whose epic, story and own issue have no milestone.");
  expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  expect(within(strip).getByText("2")).toBeInTheDocument();
});

test("a card click filters the plan to its milestone and a second click clears it", () => {
  const { unmount } = render(<MilestoneStrip projectId="p1" repo="o/r" view="timeline" mode="timeline" filters={parsePlanFilters({ q: "tokens" })} milestones={timelineMilestones} none={none} />);
  for (const card of screen.getAllByRole("button")) expect(card).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByRole("button", { name: /^Milestone Redesign beta/ }));
  expect(router.replace).toHaveBeenLastCalledWith("/projects/p1/plan?view=timeline&milestone=1&q=tokens", { scroll: false });
  fireEvent.click(screen.getByRole("button", { name: /^Tasks in no milestone/ }));
  expect(router.replace).toHaveBeenLastCalledWith("/projects/p1/plan?view=timeline&milestone=none&q=tokens", { scroll: false });
  unmount();

  render(<MilestoneStrip projectId="p1" repo="o/r" view="board" mode="timeline" filters={parsePlanFilters({ milestone: "1", status: "Ready" })} milestones={timelineMilestones} none={none} />);
  const on = screen.getByRole("button", { name: /^Milestone Redesign beta/ });
  expect(on).toHaveAttribute("aria-pressed", "true");
  expect(on.getAttribute("aria-label")).toMatch(/Showing only this milestone$/);
  fireEvent.click(on);
  expect(router.replace).toHaveBeenLastCalledWith("/projects/p1/plan?view=board&status=Ready", { scroll: false });
});

test("in Flow mode a card says where its milestone ends in the order and what it skips, with no day", () => {
  render(<MilestoneStrip projectId="p1" repo="o/r" view="flow" mode="flow" filters={parsePlanFilters({})} milestones={flowMilestones} none={{ ...none, done: 5 }} />);
  const strip = screen.getByRole("region", { name: "Milestones" });
  expect(within(strip).getByText("Flow has no dates, so each milestone shows where it ends in the order.")).toBeInTheDocument();
  const nine = within(strip).getByRole("button", { name: /^Milestone 0\.9/ });
  expect(nine).toHaveAccessibleName("Milestone 0.9, due Oct 20, 2 of 11 tasks done, ends after Next 6, 1 skipped");
  expect(within(nine).getByText("Ends after Next 6")).toHaveAttribute("data-tone", "plain");
  expect(within(nine).getByText("1 skipped")).toBeInTheDocument();
  expect(within(strip).getByRole("button", { name: /^Milestone 1\.0/ })).toHaveTextContent("Ends after Next 13");
  expect(strip).not.toHaveTextContent(/late|early/);
  // Every task in no milestone is done, so there is no No milestone card.
  expect(within(strip).queryByRole("button", { name: /no milestone/ })).not.toBeInTheDocument();
});

test("a milestone without a due date or tasks says so, and the strip hides when no milestone is open", () => {
  const plain: PlanMilestone[] = [
    { ...milestone(6, "Someday"), progress: { done: 0, total: 0, byStatus: byStatus(), timeline: { ends: undefined, daysPastDue: undefined, undated: [] } } },
    { ...milestone(7, "Later"), progress: { done: 0, total: 3, byStatus: byStatus({ Ready: 3 }), timeline: { ends: "2026-10-09", daysPastDue: undefined, undated: [70, 71, 72, 73] } } },
  ];
  const { unmount } = render(<MilestoneStrip projectId="p1" repo="o/r" view="tree" mode="timeline" filters={parsePlanFilters({})} milestones={plain} none={undefined} />);
  expect(screen.getByRole("button", { name: /^Milestone Someday/ })).toHaveAccessibleName("Milestone Someday, no due date, no tasks in it yet");
  const later = screen.getByRole("button", { name: /^Milestone Later/ });
  expect(later).toHaveAccessibleName("Milestone Later, no due date, 0 of 3 tasks done, ends Oct 9, 4 tasks have no dates");
  expect(within(later).getByText("4 tasks have no dates")).toHaveAttribute("title", "#70, #71, #72 and #73 have no dates");
  unmount();

  const { container } = render(<MilestoneStrip projectId="p1" repo="o/r" view="tree" mode="timeline" filters={parsePlanFilters({})} milestones={[timelineMilestones[2]!]} none={none} />);
  expect(container).toBeEmptyDOMElement();
});

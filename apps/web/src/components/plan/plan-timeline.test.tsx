import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TimelineRun } from "@/lib/plan/schedule";
import { parsePlanFilters } from "@/lib/plan/filters";
import { PlanTimeline } from "./plan-timeline";
import { epic, planView, PROJECT, REPO_URL, story, task, timelineOf } from "./testing/plan-fixtures";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({
  moveToReadyAction: vi.fn(async () => ({ ok: true })),
  moveToShapingAction: vi.fn(async () => ({ ok: true })),
  startRunAction: vi.fn(async () => ({})),
  listIssuesAction: vi.fn(async () => ({ issues: [] })),
  scheduleAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  addDateFieldsAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
}));
vi.mock("@/app/projects/actions", () => actions);

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

/** Friday 2026-10-02 at noon: the today of every test. */
const NOW = new Date("2026-10-02T12:00:00Z");
const PROJECT_WITH_DATES = { ...PROJECT, dateFields: { start: "f-start", target: "f-target" } };

const view = planView([
  epic(12, "Project management", [
    story(40, "Read the plan from GitHub", 12, [
      task(52, "Projects port", "Done", { state: "closed", start: "2026-09-14", target: "2026-09-18" }),
      task(53, "Plan read model", "Done", { state: "closed" }),
    ]),
    story(41, "Shaping with the assistant", 12, [
      task(55, "Shaping tools", "Running", { start: "2026-09-30", target: "2026-10-07" }),
      task(56, "Approval cards", "Running", { start: "2026-09-24", target: "2026-09-29" }),
      task(57, "Add the migration", "Shaping", { start: "2026-10-01", target: "2026-10-09", blockedBy: [55] }),
      task(58, "Plan page tree and board", "Ready"),
    ]),
  ]),
  epic(10, "Voice", [
    story(18, "Voice settings", 10, [
      task(70, "Speak replies", "Running", { start: "2026-09-28", target: "2026-10-09" }),
      task(72, "Voice picker", "Ready", { start: "2026-10-12", target: "2026-10-16", blockedBy: [70] }),
    ]),
  ]),
]);

function renderTimeline(over: { runs?: TimelineRun[]; zoom?: "weeks" | "months"; project?: typeof PROJECT; plan?: typeof view } = {}) {
  const plan = over.plan ?? view;
  return render(
    <PlanTimeline
      projectId="p1"
      repoUrl={REPO_URL}
      project={over.project ?? PROJECT_WITH_DATES}
      epics={plan.epics}
      unparented={plan.unparented}
      timeline={timelineOf(plan, over.runs ?? [], NOW)}
      zoom={over.zoom}
      filters={parsePlanFilters({})}
      needsYou={[]}
      graphs={["loop"]}
      graphName="loop"
      readAt={NOW.getTime()}
    />,
  );
}

const rowNames = () =>
  screen
    .getAllByRole("row")
    .map((r) => r.getAttribute("aria-label"))
    .filter((name) => name && /^(Epic|Story|Task)/.test(name));
const row = (name: RegExp) => screen.getByRole("row", { name });

test("rows follow the tree order with epics, stories and tasks, and a collapsed epic hides its rows", () => {
  renderTimeline();
  expect(screen.getByRole("grid", { name: "Timeline" })).toBeInTheDocument();
  expect(rowNames()).toEqual([
    "Epic #12 Project management",
    "Story #40 Read the plan from GitHub",
    "Task #52 Projects port",
    "Task #53 Plan read model",
    "Story #41 Shaping with the assistant",
    "Task #55 Shaping tools",
    "Task #56 Approval cards",
    "Task #57 Add the migration",
    "Task #58 Plan page tree and board",
    "Epic #10 Voice",
    "Story #18 Voice settings",
    "Task #70 Speak replies",
    "Task #72 Voice picker",
  ]);
  expect(within(row(/Task #57/)).getByText("Shaping")).toBeInTheDocument();
  expect(within(row(/Task #57/)).getByRole("link", { name: "#57 Add the migration" })).toHaveAttribute("href", `${REPO_URL}/issues/57`);

  fireEvent.click(within(row(/Epic #12/)).getByRole("button", { name: "Collapse Epic #12 Project management" }));
  expect(row(/Epic #12/)).toHaveAttribute("aria-expanded", "false");
  expect(rowNames()).toEqual(["Epic #12 Project management", "Epic #10 Voice", "Story #18 Voice settings", "Task #70 Speak replies", "Task #72 Voice picker"]);

  fireEvent.click(within(row(/Story #18/)).getByRole("button", { name: "Collapse Story #18 Voice settings" }));
  expect(rowNames()).toEqual(["Epic #12 Project management", "Epic #10 Voice", "Story #18 Voice settings"]);
});

test("a task bar spans its dates in its status colour and a derived story bar is drawn dashed", () => {
  // The dates run Sep 14 to Oct 16, so the chart opens on Monday Sep 7 at 14 px a day.
  renderTimeline({ zoom: "weeks" });

  const bar = within(row(/Task #57/)).getByRole("link", { name: "Task #57 Add the migration, Shaping, Oct 1 to Oct 9, blocked by #55" });
  expect(bar).toHaveAttribute("href", `${REPO_URL}/issues/57`);
  expect(bar).toHaveAttribute("data-column", "Shaping");
  expect(bar).toHaveStyle({ left: "336px", width: "126px" });
  expect(within(bar).getByText("Add the migration")).toBeInTheDocument();

  const ready = within(row(/Task #72/)).getByRole("link", { name: /^Task #72 Voice picker, Ready, Oct 12 to Oct 16/ });
  expect(ready).toHaveAttribute("data-column", "Ready");
  expect(within(ready).queryByText("Voice picker")).not.toBeInTheDocument();

  const derived = within(row(/Story #41/)).getByRole("link", { name: "Story #41 Shaping with the assistant, Sep 24 to Oct 9, derived from its tasks" });
  expect(derived).toHaveAttribute("data-span", "derived");
  expect(derived).toHaveStyle({ left: "238px", width: "224px" });
  expect(within(row(/Task #58/)).queryByRole("link", { name: /^Task #58/ })).not.toBeInTheDocument();
});

test("actual strips render one per run under the planned bar and link to the run", () => {
  const runs: TimelineRun[] = [
    { id: "a3f09c21-0000-4000-8000-000000000001", status: "failed", issues: [55], startedAt: "2026-09-26T09:00:00Z", finishedAt: "2026-09-30T09:00:00Z" },
    { id: "b7710e42-0000-4000-8000-000000000002", status: "running", issues: [55], startedAt: "2026-10-01T12:00:00Z", finishedAt: null },
    { id: "c0ffee00-0000-4000-8000-000000000003", status: "succeeded", issues: [53], startedAt: "2026-09-21T08:00:00Z", finishedAt: "2026-09-22T08:00:00Z" },
    { id: "d00d0000-0000-4000-8000-000000000004", status: "queued", issues: [58], startedAt: null, finishedAt: null },
  ];
  renderTimeline({ runs, zoom: "weeks" });

  const strips = within(row(/Task #55/)).getAllByRole("link", { name: /^Run / });
  expect(strips.map((s) => s.getAttribute("aria-label"))).toEqual(["Run b7710e42 of #55 Shaping tools, running, Oct 1 to now", "Run a3f09c21 of #55 Shaping tools, failed, Sep 26 to Sep 30"]);
  expect(strips[0]).toHaveAttribute("href", "/projects/p1/runs/b7710e42-0000-4000-8000-000000000002");
  expect(strips[1]).toHaveAttribute("href", "/projects/p1/runs/a3f09c21-0000-4000-8000-000000000001");
  // Four days at 14 px a day is wide enough for the short id; one day is not.
  expect(within(row(/Task #55/)).getByText("a3f09c21")).toBeInTheDocument();
  expect(within(row(/Task #55/)).queryByText("b7710e42")).not.toBeInTheDocument();

  // A task with a run but no dates shows its strip alone; a queued run has no strip until it starts.
  expect(within(row(/Task #53/)).getByRole("link", { name: /^Run c0ffee00 of #53/ })).toHaveAttribute("href", "/projects/p1/runs/c0ffee00-0000-4000-8000-000000000003");
  expect(within(row(/Task #53/)).queryByRole("link", { name: /^Task #53/ })).not.toBeInTheDocument();
  expect(within(row(/Task #58/)).queryByRole("link", { name: /^Run / })).not.toBeInTheDocument();
});

test("a late task shows Late: waiting on its blockers with a red arrow and an overdue task shows Overdue by n days", () => {
  const { container } = renderTimeline({ zoom: "weeks" });
  const arrow = (from: number, to: number) => container.querySelector(`[data-arrow="${from}-${to}"]`);

  // #57 was due to start Oct 1 while #55 still runs.
  expect(within(row(/Task #57/)).getByText("Late: waiting on #55")).toBeInTheDocument();
  expect(within(row(/Task #57/)).getByRole("link", { name: /^Task #57/ })).toHaveAttribute("data-late", "true");
  expect(arrow(55, 57)).toHaveAttribute("data-late", "true");

  // #72 waits on #70 but starts Oct 12, so it is blocked, not late.
  expect(within(row(/Task #72/)).getByText("Blocked by #70")).toBeInTheDocument();
  expect(within(row(/Task #72/)).queryByText(/Late/)).not.toBeInTheDocument();
  expect(arrow(70, 72)).toHaveAttribute("data-late", "false");

  // #56 ended Sep 29 and is not done.
  expect(within(row(/Task #56/)).getByText("Overdue by 3 days")).toBeInTheDocument();
  expect(within(row(/Task #55/)).queryByText(/Overdue/)).not.toBeInTheDocument();

  // Both ends inside a collapsed epic: the arrow goes with them.
  fireEvent.click(within(row(/Epic #10/)).getByRole("button", { name: "Collapse Epic #10 Voice" }));
  expect(arrow(70, 72)).toBeNull();
  expect(arrow(55, 57)).not.toBeNull();
});

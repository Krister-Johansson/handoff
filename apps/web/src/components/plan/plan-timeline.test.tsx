import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TimelineRun } from "@/lib/plan/schedule";
import type { PlanTask } from "@/server/plan";
import type { ArrangeState } from "@/app/projects/actions";
import type { Zoom } from "@/lib/plan/timeline-scale";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parsePlanFilters } from "@/lib/plan/filters";
import { parseZoom } from "@/lib/project-tab";

import { PlanTimeline } from "./plan-timeline";
import { KEY_DELAY } from "./use-bar-drag";
import { TimelineControls } from "./timeline-parts";
import { Sizing } from "./plan-context";
import { epic, milestone, planView, PROJECT, REPO_URL, run, sizedTimelineOf, sizingOf, story, task, timelineOf, withMilestones } from "./testing/plan-fixtures";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({
  moveToReadyAction: vi.fn(async () => ({ ok: true })),
  moveToShapingAction: vi.fn(async () => ({ ok: true })),
  startRunAction: vi.fn(async () => ({})),
  listIssuesAction: vi.fn(async () => ({ issues: [] })),
  scheduleAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  addDateFieldsAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  addEstimateFieldsAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  setSizeAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  moveItemAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  saveArrangeAction: vi.fn(async (input: { items: { issue: number }[] }): Promise<ArrangeState> => ({ ok: true, saved: input.items.map((i) => i.issue), refused: [] })),
  setCapacityAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
}));
vi.mock("@/app/projects/actions", () => actions);

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Sonner keeps its toasts in a module; each test starts with none.
  toast.dismiss();
  // Drops the timeouts a test on fake timers left pending, such as a toast's auto close.
  vi.useRealTimers();
});

/**
 * Testing Library's waitFor and findBy advance fake timers only when they see Jest's; `vi` stands in for it, so
 * they advance Vitest's fake clock instead of waiting on the wall clock.
 */
Object.assign(globalThis, { jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) } });

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

function renderTimeline(over: { runs?: TimelineRun[]; zoom?: Zoom; project?: typeof PROJECT; plan?: typeof view; needsYou?: string[] } = {}) {
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
      needsYou={over.needsYou ?? []}
      graphs={["loop"]}
      graphName="loop"
      readAt={NOW.getTime()}
    />,
    { wrapper: TooltipProvider },
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

test("a late, blocked or overdue task shows a warning icon after its title that names what it flags, and a late one has a red arrow", async () => {
  const { container } = renderTimeline({ zoom: "weeks" });
  const arrow = (from: number, to: number) => container.querySelector(`[data-arrow="${from}-${to}"]`);
  const label = (name: RegExp) => within(row(name)).getByRole("rowheader");

  // #57 was due to start Oct 1 while #55 still runs.
  expect(within(label(/Task #57/)).getByRole("button", { name: "Late: waiting on #55" })).toBeInTheDocument();
  expect(within(label(/Task #57/)).queryByText("Late: waiting on #55")).not.toBeInTheDocument();
  expect(within(row(/Task #57/)).getByRole("link", { name: /^Task #57/ })).toHaveAttribute("data-late", "true");
  expect(arrow(55, 57)).toHaveAttribute("data-late", "true");

  // #72 waits on #70 but starts Oct 12, so it is blocked, not late; the chip under the title is gone.
  expect(within(label(/Task #72/)).getByRole("button", { name: "Blocked by #70" })).toBeInTheDocument();
  expect(within(label(/Task #72/)).queryByText("Blocked by #70")).not.toBeInTheDocument();
  expect(arrow(70, 72)).toHaveAttribute("data-late", "false");

  // #56 ended Sep 29 and is not done; #55 has nothing to flag.
  const overdue = within(label(/Task #56/)).getByRole("button", { name: "Overdue by 3 days" });
  expect(within(label(/Task #55/)).queryByRole("button", { name: /Overdue|Blocked|Late/ })).not.toBeInTheDocument();

  // Focus opens the flags' card, with the Target it missed.
  fireEvent.focus(overdue);
  const card = await screen.findByRole("group", { name: "Flags of #56 Approval cards" });
  expect(within(card).getByRole("term")).toHaveTextContent("Overdue");
  expect(within(card).getByRole("definition")).toHaveTextContent("Target was Sep 29, 3 days ago");

  // Both ends inside a collapsed epic: the arrow goes with them.
  fireEvent.click(within(row(/Epic #10/)).getByRole("button", { name: "Collapse Epic #10 Voice" }));
  expect(arrow(70, 72)).toBeNull();
  expect(arrow(55, 57)).not.toBeNull();
});

test("one warning icon names every flag of a task, and its card links the run that waits on you and shows the active run's state", async () => {
  const waiting = planView([
    epic(12, "Project management", [story(41, "Shaping", 12, [task(56, "Approval cards", "Running", { start: "2026-09-24", target: "2026-09-29", run: run("r6", "waiting") })])]),
  ]);
  renderTimeline({ plan: waiting, zoom: "weeks", needsYou: ["r6"] });
  const icon = within(row(/Task #56/)).getByRole("button", { name: "Overdue by 3 days. Waiting on you" });

  fireEvent.focus(icon);
  const card = await screen.findByRole("group", { name: "Flags of #56 Approval cards" });
  expect(within(card).getAllByRole("term").map((t) => t.textContent)).toEqual(["Overdue", "Needs you", "Run"]);
  expect(within(card).getByRole("link", { name: "See what the run waits on" })).toHaveAttribute("href", "/projects/p1/runs/r6");
  expect(within(card).getByRole("link", { name: "Run r6, waiting" })).toHaveAttribute("href", "/projects/p1/runs/r6");
});

test("the warning icon opens a card on focus with each blocker's kind, title, status and state, linked to its issue, and Escape closes it", async () => {
  const blocked = planView([
    epic(12, "Project management", [
      story(41, "Shaping", 12, [
        task(52, "Projects port", "Done", { state: "closed" }),
        task(55, "Shaping tools", "Running", { start: "2026-09-30", target: "2026-10-07" }),
        task(57, "Add the migration", "Shaping", { start: "2026-10-01", target: "2026-10-09", blockers: [55, 52, 151], blockedBy: [55, 151] }),
      ]),
    ]),
  ]);
  renderTimeline({ plan: blocked, zoom: "weeks" });
  const icon = within(row(/Task #57/)).getByRole("button", { name: "Late: waiting on #55, #151" });
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

  fireEvent.focus(icon);
  const card = await screen.findByRole("group", { name: "Flags of #57 Add the migration" });
  const blocker = (n: number) => within(card).getByRole("listitem", { name: new RegExp(`^#${n}\\b`) });
  expect(within(card).getByRole("link", { name: "#57 Add the migration" })).toHaveAttribute("href", "/projects/p1/issues/57");
  expect(within(card).getAllByRole("term").map((t) => t.textContent)).toEqual(["Late", "Blocked by"]);
  expect(within(card).getAllByRole("definition")[0]).toHaveTextContent("Start was Oct 1; waits on #55, #151");

  expect(within(blocker(55)).getByRole("link", { name: "#55 Shaping tools" })).toHaveAttribute("href", "/projects/p1/issues/55");
  expect(within(blocker(55)).getByText("Task")).toBeInTheDocument();
  expect(within(blocker(55)).getByText("Running")).toBeInTheDocument();
  expect(within(blocker(55)).getByText("Open")).toBeInTheDocument();

  expect(within(blocker(52)).getByRole("link", { name: "#52 Projects port" })).toHaveAttribute("href", "/projects/p1/issues/52");
  expect(within(blocker(52)).getByText("Done")).toBeInTheDocument();
  expect(within(blocker(52)).getByText("Closed")).toBeInTheDocument();

  // #151 is not an item of the Project: its number, that it is outside the plan, and GitHub's open state.
  expect(within(blocker(151)).getByRole("link", { name: "#151" })).toHaveAttribute("href", "/projects/p1/issues/151");
  expect(within(blocker(151)).getByText("Outside the plan")).toBeInTheDocument();
  expect(within(blocker(151)).getByText("Open")).toBeInTheDocument();

  fireEvent.keyDown(icon, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("group", { name: /^Flags of/ })).not.toBeInTheDocument());
});

test("a task outside its window names the nearest dated story or epic in the card, with both spans", async () => {
  const outside = planView([
    epic(12, "Project management", [
      story(41, "Shaping", 12, [task(55, "Shaping tools", "Running", { start: "2026-09-30", target: "2026-10-07" })], { start: "2026-10-01", target: "2026-10-05" }),
      // A story without dates of its own: the epic's window is the one that counts.
      story(42, "Context", 12, [task(59, "Part of section", "Ready", { start: "2026-10-20", target: "2026-10-22" })]),
    ], [], { start: "2026-09-28", target: "2026-10-16" }),
  ]);
  renderTimeline({ plan: outside, zoom: "weeks" });

  fireEvent.focus(within(row(/Task #55/)).getByRole("button", { name: "Outside story window" }));
  const card = await screen.findByRole("group", { name: "Flags of #55 Shaping tools" });
  expect(within(card).getByRole("term")).toHaveTextContent("Window");
  expect(within(card).getByRole("definition")).toHaveTextContent("Sep 30 to Oct 7 leaves Story #41 Shaping, Oct 1 to Oct 5");

  fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
  fireEvent.focus(within(row(/Task #59/)).getByRole("button", { name: "Outside epic window" }));
  const epicCard = await screen.findByRole("group", { name: "Flags of #59 Part of section" });
  expect(within(epicCard).getByRole("definition")).toHaveTextContent("Oct 20 to Oct 22 leaves Epic #12 Project management, Sep 28 to Oct 16");
});

test("an unscheduled item appears in the Unscheduled block with a Schedule button", () => {
  const { unmount } = renderTimeline();
  const block = screen.getByRole("region", { name: "Unscheduled" });
  expect(within(block).getByText("2")).toBeInTheDocument();
  expect(within(block).getByText("Project management")).toBeInTheDocument();
  expect(within(block).getByRole("link", { name: "#53 Plan read model" })).toHaveAttribute("href", `${REPO_URL}/issues/53`);
  expect(within(block).getByRole("button", { name: "Schedule #58 Plan page tree and board" })).toBeInTheDocument();
  expect(within(block).queryByText(/#57/)).not.toBeInTheDocument();
  expect(within(block).queryByText(/Give tasks a Start and Target/)).not.toBeInTheDocument();

  fireEvent.click(within(block).getByRole("button", { name: /^Unscheduled/ }));
  expect(within(block).queryByRole("button", { name: /^Schedule #58/ })).not.toBeInTheDocument();
  unmount();

  // Nothing dated: every item is listed, with the hint, and the chart keeps its rows.
  const undated = planView([epic(12, "Project management", [story(41, "Shaping with the assistant", 12, [task(54, "Status writes", "In review")])])]);
  renderTimeline({ plan: undated });
  const all = screen.getByRole("region", { name: "Unscheduled" });
  expect(within(all).getByText("Give tasks a Start and Target to see them on the timeline, or ask the assistant to schedule an epic.")).toBeInTheDocument();
  expect(within(all).getAllByRole("button", { name: /^Schedule #/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
    "Schedule #12 Project management",
    "Schedule #41 Shaping with the assistant",
    "Schedule #54 Status writes",
  ]);
  expect(row(/Task #54/)).toBeInTheDocument();
});

test("the schedule dialog is prefilled, refuses a Target before Start, and saves through scheduleAction", async () => {
  renderTimeline();
  fireEvent.keyDown(within(row(/Task #57/)).getByRole("button", { name: "Actions for #57" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Schedule" }));

  const dialog = await screen.findByRole("dialog", { name: "Schedule #57 Add the migration" });
  const start = within(dialog).getByLabelText("Start");
  const target = within(dialog).getByLabelText("Target");
  expect(start).toHaveValue("2026-10-01");
  expect(target).toHaveValue("2026-10-09");
  expect(within(dialog).getByText("Was Oct 1")).toBeInTheDocument();
  expect(within(dialog).getByText("Was Oct 9")).toBeInTheDocument();
  expect(within(dialog).getByText("Story #41 Shaping with the assistant spans Sep 24 to Oct 9, derived from its tasks.")).toBeInTheDocument();
  expect(within(dialog).getByText("Blocked by #55, planned to end Oct 7.")).toBeInTheDocument();

  fireEvent.change(target, { target: { value: "2026-09-30" } });
  expect(within(dialog).getByText("Target must be on or after Start.")).toBeInTheDocument();
  expect(target).toHaveAttribute("aria-invalid", "true");
  expect(within(dialog).getByRole("button", { name: "Save to GitHub" })).toBeDisabled();

  fireEvent.change(start, { target: { value: "2026-10-08" } });
  fireEvent.change(target, { target: { value: "2026-10-14" } });
  expect(within(dialog).queryByText("Target must be on or after Start.")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save to GitHub" }));
  await waitFor(() => expect(actions.scheduleAction).toHaveBeenCalledWith({ projectId: "p1", issue: 57, start: "2026-10-08", target: "2026-10-14" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  // From Unscheduled: nothing set yet, Clear empties a field, null clears it on GitHub, and a refusal is shown.
  actions.scheduleAction.mockResolvedValueOnce({ ok: false, error: "This Project has no Start and Target fields." });
  fireEvent.click(within(screen.getByRole("region", { name: "Unscheduled" })).getByRole("button", { name: "Schedule #58 Plan page tree and board" }));
  const empty = await screen.findByRole("dialog", { name: "Schedule #58 Plan page tree and board" });
  expect(within(empty).getAllByText("Was not set")).toHaveLength(2);
  fireEvent.change(within(empty).getByLabelText("Start"), { target: { value: "2026-10-21" } });
  fireEvent.change(within(empty).getByLabelText("Target"), { target: { value: "2026-10-23" } });
  fireEvent.click(within(empty).getByRole("button", { name: "Clear Target" }));
  expect(within(empty).getByLabelText("Target")).toHaveValue("");
  fireEvent.click(within(empty).getByRole("button", { name: "Save to GitHub" }));
  await waitFor(() => expect(actions.scheduleAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 58, start: "2026-10-21", target: null }));
  expect(await within(empty).findByText("This Project has no Start and Target fields.")).toBeInTheDocument();
});

test("the chart opens on today with Weeks under ten weeks of dates, its Today button scrolls back, and Months shows quarters", () => {
  const scrollTo = vi.spyOn(Element.prototype, "scrollTo");
  const todayRef: { current: (() => void) | null } = { current: null };
  const { unmount } = render(
    <PlanTimeline
      projectId="p1"
      repoUrl={REPO_URL}
      project={PROJECT_WITH_DATES}
      epics={view.epics}
      unparented={[]}
      timeline={timelineOf(view, [], NOW)}
      zoom={undefined}
      filters={parsePlanFilters({ epic: "12" })}
      needsYou={[]}
      graphs={["loop"]}
      graphName="loop"
      readAt={NOW.getTime()}
      todayRef={todayRef}
    />,
    { wrapper: TooltipProvider },
  );
  expect(screen.getByText("W40")).toBeInTheDocument();
  expect(scrollTo).toHaveBeenCalledTimes(1);

  act(() => todayRef.current?.());
  expect(scrollTo).toHaveBeenCalledTimes(2);
  expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: "smooth", left: expect.any(Number) }));
  unmount();
  expect(todayRef.current).toBeNull();

  renderTimeline({ zoom: "months" });
  expect(screen.getByText("Q4 2026")).toBeInTheDocument();
  expect(screen.queryByText("W40")).not.toBeInTheDocument();
  scrollTo.mockRestore();
});

const SIZE_FIELDS = { size: { id: "f-size", options: { S: "s", M: "m", L: "l" } }, estimate: "f-estimate" };

test("a Project without Start, Target or Estimate shows one notice naming them, with Add the fields", async () => {
  const { unmount } = renderTimeline({ project: { ...PROJECT_WITH_DATES, estimateFields: SIZE_FIELDS } });
  expect(screen.queryByText(/This Project has no/)).not.toBeInTheDocument();
  unmount();

  // A Flow project's Project, as setup_plan made it with Size only, after the switch to Timeline (#587).
  actions.addDateFieldsAction.mockResolvedValueOnce({ ok: false, error: "GitHub refused the field." });
  renderTimeline({ project: { ...PROJECT, dateFields: { start: undefined, target: undefined }, estimateFields: { size: SIZE_FIELDS.size, estimate: undefined } } });
  const notice = screen.getByRole("alert");
  expect(within(notice).getByText("This Project has no Start, Target or Estimate field")).toBeInTheDocument();
  expect(notice).toHaveTextContent('The missing fields are added to the GitHub Project. GitHub\'s roadmap also needs Start and Target picked once under "Date fields".');

  fireEvent.click(within(notice).getByRole("button", { name: "Add the fields" }));
  const confirm = await screen.findByRole("alertdialog", { name: "Add Start, Target and Estimate to handoff plan?" });
  expect(actions.addDateFieldsAction).not.toHaveBeenCalled();
  const add = within(confirm).getByRole("button", { name: "Add the fields" });
  fireEvent.click(add);
  // The same actions as Add the fields in Settings, Projects: the date fields, then Size and Estimate.
  await waitFor(() => expect(actions.addEstimateFieldsAction).toHaveBeenCalledWith({ projectId: "p1" }));
  expect(actions.addDateFieldsAction).toHaveBeenCalledWith({ projectId: "p1" });
  expect(await within(confirm).findByText("GitHub refused the field.")).toBeInTheDocument();

  // The button comes back once the refused write has settled; the second try closes the dialog.
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(actions.addDateFieldsAction).toHaveBeenCalledTimes(2);
});

test("the notice names a Size field without S, M or L, and a Project without Size and Estimate", () => {
  const partial = renderTimeline({ project: { ...PROJECT_WITH_DATES, estimateFields: { size: { id: "f-size", options: { S: undefined, M: undefined, L: undefined } }, estimate: "f-estimate" } } });
  expect(screen.getByText("The Size field has no S, M or L option")).toBeInTheDocument();
  partial.unmount();

  const none = renderTimeline({ project: { ...PROJECT_WITH_DATES, estimateFields: { size: undefined, estimate: undefined } } });
  expect(screen.getByText("This Project has no Size or Estimate field")).toBeInTheDocument();
  none.unmount();

  renderTimeline({ project: { ...PROJECT, dateFields: { start: "f-start", target: undefined }, estimateFields: { size: { id: "f-size", options: { S: "s", M: "m", L: undefined } }, estimate: "f-estimate" } } });
  expect(screen.getByText("This Project has no Target field, and the Size field has no L option")).toBeInTheDocument();
});

test("timeline task rows and Unscheduled carry the size chip, and stories and epics the sum of their tasks", () => {
  const sized = planView([
    epic(12, "Project management", [
      story(41, "Shaping with the assistant", 12, [
        task(55, "Shaping tools", "Running", { start: "2026-09-30", target: "2026-10-07", size: "M" }),
        task(58, "Plan page tree and board", "Ready", { size: "S" }),
      ]),
    ]),
  ]);
  render(
    <Sizing value={sizingOf()}>
      <PlanTimeline
        projectId="p1"
        repoUrl={REPO_URL}
        project={{ ...PROJECT_WITH_DATES, estimateFields: SIZE_FIELDS }}
        epics={sized.epics}
        unparented={[]}
        timeline={timelineOf(sized, [], NOW)}
        zoom={undefined}
        filters={parsePlanFilters({})}
        needsYou={[]}
        graphs={["loop"]}
        graphName="loop"
        readAt={NOW.getTime()}
      />
    </Sizing>,
    { wrapper: TooltipProvider },
  );
  expect(within(row(/Task #55/)).getByRole("button", { name: "Size M, forecast 50m. Change the size or estimate of #55" })).toBeInTheDocument();
  expect(within(row(/Story #41/)).getByTitle("1 hour 15 minutes over 2 tasks, forecasts")).toHaveTextContent(/^~1h 15m$/);
  expect(within(row(/Epic #12/)).getByTitle("1 hour 15 minutes over 2 tasks, forecasts")).toBeInTheDocument();
  const unscheduled = screen.getByRole("region", { name: "Unscheduled" });
  expect(within(unscheduled).getByRole("button", { name: "Size S, forecast 25m. Change the size or estimate of #58" })).toBeInTheDocument();
});

test("the Days zoom lives in the URL", () => {
  const timeline = timelineOf(view, [], NOW);
  const { unmount } = render(<TimelineControls projectId="p1" filters={parsePlanFilters({ epic: "12" })} timeline={timeline} zoom="weeks" narrow={false} onToday={() => {}} />, { wrapper: TooltipProvider });
  const zoom = screen.getByRole("radiogroup", { name: "Zoom" });
  expect(within(zoom).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Days", "Weeks", "Months"]);
  fireEvent.click(within(zoom).getByRole("radio", { name: "Days" }));
  expect(router.replace).toHaveBeenLastCalledWith("/projects/p1/plan?view=timeline&epic=12&zoom=days", { scroll: false });
  expect(parseZoom({ zoom: "days" })).toBe("days");
  unmount();

  // At Days a day is 96 px with its weekday: #57 starts Thursday Oct 1, four weeks after Monday Sep 7.
  renderTimeline({ zoom: "days" });
  expect(screen.getByText("Thu 1")).toBeInTheDocument();
  expect(within(row(/Task #57/)).getByRole("link", { name: /^Task #57/ })).toHaveStyle({ left: `${24 * 96}px`, width: `${9 * 96}px` });
});

/**
 * Epic #120 at 6 hours a day, as the design draws it: #141 (Done, S) and #142 (Running, M) on Oct 1, #143 (L with a
 * manual 9 hours) from Oct 2, #145 and #146 (M) on Oct 3 after #143, #149 (L, its 2h default) on Oct 4, and in
 * Unscheduled #152 without a size and #153 sized S.
 */
const sized = planView([
  epic(120, "Refined product redesign", [
    story(125, "Redesign foundations in code", 120, [
      task(141, "R1 Redesign tokens", "Done", { state: "closed", start: "2026-10-01", target: "2026-10-01", size: "S" }),
      task(142, "R2 Geist type", "Running", { start: "2026-10-01", target: "2026-10-01", size: "M", run: run("r142", "running") }),
    ]),
    story(126, "Restyle the shell", 120, [
      task(143, "R3 Restyle the sidebar", "Ready", { start: "2026-10-02", target: "2026-10-03", size: "L", estimate: 9, blockedBy: [142] }),
      task(145, "R5 Restyle board columns", "Shaping", { start: "2026-10-03", target: "2026-10-03", size: "M", blockedBy: [143] }),
      task(146, "R6 Restyle the list view", "Shaping", { start: "2026-10-03", target: "2026-10-03", size: "M", blockedBy: [143] }),
      task(149, "R9 Restyle dialogs", "Shaping", { start: "2026-10-04", target: "2026-10-04", size: "L", blockedBy: [143] }),
      task(152, "Document the workflow", "Shaping"),
      task(153, "Restyle the help page", "Shaping", { size: "S" }),
    ]),
  ]),
]);

/**
 * The sized plan at the Days zoom with the Plan page's sizing and its toasts. The chart opens on Monday Sep 14, so
 * Oct 1 is 17 days of 96 px in. Timeouts are fake: a keyboard move's save, sonner's renders and auto close, and
 * the hover card's open delay run on the fake clock, which only waitFor, findBy and the test move, so no test
 * depends on how fast the machine runs.
 */
function renderSized(over: { plan?: typeof sized; runs?: TimelineRun[]; zoom?: Zoom } = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const plan = over.plan ?? sized;
  const timeline = sizedTimelineOf(plan, over.runs ?? [], NOW);
  const spans = new Map(timeline.items.map((i) => [i.number, i.planned]));
  return render(
    <Sizing value={sizingOf({ spanOf: (n) => spans.get(n) })}>
      <PlanTimeline
        projectId="p1"
        repoUrl={REPO_URL}
        project={{ ...PROJECT_WITH_DATES, estimateFields: SIZE_FIELDS }}
        epics={plan.epics}
        unparented={plan.unparented}
        timeline={timeline}
        zoom={over.zoom ?? "days"}
        filters={parsePlanFilters({})}
        needsYou={[]}
        graphs={["loop"]}
        graphName="loop"
        readAt={NOW.getTime()}
      />
      <Toaster />
    </Sizing>,
    { wrapper: TooltipProvider },
  );
}

const DAY = 96;
const OCT_1 = 17 * DAY;
/**
 * #146 on Oct 3 at 16 px an hour: #145 and #146 wait on #143, so they start after the 3 hours #143 runs into
 * Oct 3, and #146 follows #145's 50 minutes (13.3 px).
 */
const AT_146 = OCT_1 + 2 * DAY + 3 * 16 + 13.33;
const barOf = (n: number) => within(row(new RegExp(`^Task #${n} `))).getByRole("link", { name: new RegExp(`^Task #${n} `) });
const leftOf = (el: HTMLElement) => parseFloat(el.style.left);
const widthOf = (el: HTMLElement) => parseFloat(el.style.width);
const dragTip = () => within(screen.getByRole("grid", { name: "Timeline" })).queryByRole("status");

test("dragging a bar moves its Start a day at a time and the tooltip names the Target that follows", () => {
  renderSized();
  const bar = barOf(146);
  expect(leftOf(bar)).toBeCloseTo(AT_146, 1);
  expect(widthOf(bar)).toBeCloseTo(13.33, 1);

  fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 500 });
  fireEvent.pointerMove(bar, { pointerId: 1, clientX: 540 });
  expect(dragTip()).toHaveTextContent("Sat Oct 3M, forecast ~50m. Target Oct 3");

  // Past half a day it snaps to Sunday, where nothing comes before it.
  fireEvent.pointerMove(bar, { pointerId: 1, clientX: 560 });
  expect(dragTip()).toHaveTextContent("Sun Oct 4M, forecast ~50m. Target Oct 4");
  expect(leftOf(bar)).toBe(OCT_1 + 3 * DAY);
  fireEvent.pointerMove(bar, { pointerId: 1, clientX: 700 });
  expect(dragTip()).toHaveTextContent("Mon Oct 5M, forecast ~50m. Target Oct 5");
  expect(leftOf(bar)).toBe(OCT_1 + 4 * DAY);

  // Escape puts it back and saves nothing.
  fireEvent.keyDown(bar, { key: "Escape" });
  expect(dragTip()).not.toBeInTheDocument();
  expect(leftOf(bar)).toBeCloseTo(AT_146, 1);
  fireEvent.pointerUp(bar, { pointerId: 1, clientX: 700 });
  expect(actions.moveItemAction).not.toHaveBeenCalled();
  // The click that ends a drag does not open the issue; a click after it does.
  expect(fireEvent.click(bar)).toBe(false);
  expect(fireEvent.click(bar)).toBe(true);
});

/** Drags a bar by its body from x 500 by `dx` pixels and lets go. */
function dragBy(bar: HTMLElement, dx: number) {
  fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 500 });
  fireEvent.pointerMove(bar, { pointerId: 1, clientX: 500 + dx });
  fireEvent.pointerUp(bar, { pointerId: 1, clientX: 500 + dx });
}

test("dropping saves Start and Target and the toast's Undo writes the old dates back", async () => {
  renderSized();
  dragBy(barOf(146), DAY);

  expect(await screen.findByText("Saving #146 to GitHub")).toBeInTheDocument();
  await waitFor(() => expect(actions.moveItemAction).toHaveBeenCalledWith({ projectId: "p1", issue: 146, start: "2026-10-04", target: "2026-10-04" }));
  expect(await screen.findByText("Moved #146 to Oct 4")).toBeInTheDocument();
  expect(screen.getByText("Saved to GitHub.")).toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();
  // The bar stays where it was dropped until the next read from GitHub.
  expect(leftOf(barOf(146))).toBe(OCT_1 + 3 * DAY);
  expect(barOf(146)).toHaveAccessibleName(/, Oct 4,/);

  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(actions.moveItemAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 146, start: "2026-10-03", target: "2026-10-03" }));
  expect(await screen.findByText("Put #146 back on Oct 3")).toBeInTheDocument();
  expect(leftOf(barOf(146))).toBeCloseTo(AT_146, 1);
  expect(actions.moveItemAction).toHaveBeenCalledTimes(2);
});

test("a refused write puts the bar back and offers Try again", async () => {
  actions.moveItemAction.mockResolvedValueOnce({ ok: false, error: "GitHub API rate limit exceeded." });
  renderSized();
  dragBy(barOf(146), DAY);

  expect(await screen.findByText("GitHub did not take the date")).toBeInTheDocument();
  expect(screen.getByText("#146 is back on Oct 3. GitHub API rate limit exceeded.")).toBeInTheDocument();
  expect(leftOf(barOf(146))).toBeCloseTo(AT_146, 1);
  expect(router.refresh).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Moved #146 to Oct 4")).toBeInTheDocument();
  expect(actions.moveItemAction).toHaveBeenCalledTimes(2);
  expect(actions.moveItemAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 146, start: "2026-10-04", target: "2026-10-04" });
  expect(leftOf(barOf(146))).toBe(OCT_1 + 3 * DAY);
});

test("dragging the end of a sized task sets a manual estimate in hours and keeps the size", async () => {
  const { container } = renderSized();
  const bar = barOf(149);
  expect(widthOf(bar)).toBe(32);
  const end = bar.querySelector<HTMLElement>("[data-end]")!;

  // 16 px an hour: two hours more than L's 2h default.
  fireEvent.pointerDown(end, { pointerId: 1, button: 0, clientX: 500 });
  fireEvent.pointerMove(end, { pointerId: 1, clientX: 530 });
  expect(dragTip()).toHaveTextContent("Manual estimate 4hOverrides the L default of 2h. Target stays Oct 4.");
  expect(widthOf(bar)).toBe(64);
  expect(leftOf(bar)).toBe(OCT_1 + 3 * DAY);
  expect(container.querySelector("[data-ghost]")).toHaveStyle({ width: "32px" });

  // Four more hours run past the day's six.
  fireEvent.pointerMove(end, { pointerId: 1, clientX: 594 });
  expect(dragTip()).toHaveTextContent("Manual estimate 1d 2hOverrides the L default of 2h. Target moves to Oct 5.");
  fireEvent.pointerMove(end, { pointerId: 1, clientX: 530 });
  fireEvent.pointerUp(end, { pointerId: 1, clientX: 530 });

  await waitFor(() => expect(actions.moveItemAction).toHaveBeenCalledWith({ projectId: "p1", issue: 149, start: "2026-10-04", target: "2026-10-04", estimate: 4 }));
  expect(await screen.findByText("#149 has a manual estimate of 4h")).toBeInTheDocument();
  expect(screen.getByText("Saved to GitHub. Its size stays L.")).toBeInTheDocument();
  expect(within(row(/^Task #149 /)).getByRole("button", { name: "Size L, manual estimate 4h. Change the size or estimate of #149" })).toBeInTheDocument();
  expect(widthOf(barOf(149))).toBe(64);

  // Undo clears the estimate again.
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(actions.moveItemAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 149, start: "2026-10-04", target: "2026-10-04", estimate: null }));
});

test("a drop before a blocker ends is allowed with the warning", async () => {
  const { container } = renderSized();
  const label = within(row(/^Task #149 /)).getByRole("rowheader");
  expect(within(label).queryByRole("button", { name: /Starts before/ })).not.toBeInTheDocument();

  // On Oct 3, the day #143 ends, #149 starts after #143's last 3 hours, #145 and #146, and runs into Oct 4: no warning.
  const bar = barOf(149);
  fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 500 });
  fireEvent.pointerMove(bar, { pointerId: 1, clientX: 500 - DAY });
  expect(dragTip()).toHaveTextContent("Sat Oct 3 to Sun Oct 4L, default ~2h. Target Oct 4");
  expect(dragTip()).not.toHaveTextContent("Starts before");
  // On Oct 1 it starts the day before #143 does.
  fireEvent.pointerMove(bar, { pointerId: 1, clientX: 500 - 3 * DAY });
  expect(dragTip()).toHaveTextContent("Thu Oct 1L, default ~2h. Target Oct 1Starts before #143 ends on Oct 3");
  fireEvent.pointerUp(bar, { pointerId: 1, clientX: 500 - 3 * DAY });

  await waitFor(() => expect(actions.moveItemAction).toHaveBeenCalledWith({ projectId: "p1", issue: 149, start: "2026-10-01", target: "2026-10-01" }));
  expect(await screen.findByText("Moved #149 to Oct 1")).toBeInTheDocument();
  expect(screen.getByText("Saved to GitHub. It starts before #143 ends.")).toBeInTheDocument();

  // The row warns, the bar's left edge and the arrow from its blocker turn red, and the blocker stays put.
  expect(within(label).getByRole("button", { name: "Blocked by #143. Starts before #143 ends" })).toBeInTheDocument();
  expect(barOf(149)).toHaveAttribute("data-early", "true");
  expect(container.querySelector('[data-arrow="143-149"]')).toHaveAttribute("data-early", "true");
  expect(container.querySelector('[data-arrow="142-143"]')).toHaveAttribute("data-early", "false");
  expect(leftOf(barOf(143))).toBe(OCT_1 + DAY);
});

test("Done and Running bars do not drag", () => {
  renderSized();
  for (const n of [141, 142]) {
    const bar = barOf(n);
    const left = leftOf(bar);
    expect(bar.querySelector("[data-end]")).toBeNull();
    fireEvent.pointerDown(bar, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 500 + 2 * DAY });
    expect(dragTip()).not.toBeInTheDocument();
    expect(leftOf(bar)).toBe(left);
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 500 + 2 * DAY });
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(dragTip()).not.toBeInTheDocument();
    expect(bar).not.toHaveAttribute("aria-keyshortcuts");
  }
  // A Ready task moves.
  expect(barOf(143)).toHaveAttribute("aria-keyshortcuts");
  expect(actions.moveItemAction).not.toHaveBeenCalled();
});

test("arrows move a focused bar a day and Shift with an arrow changes its estimate, with one save after the last key", async () => {
  renderSized();
  const bar = barOf(146);
  act(() => bar.focus());
  const keys = screen.getByRole("group", { name: "Keys for bar #146" });
  expect(keys).toHaveTextContent("Move a day");
  expect(keys).toHaveTextContent("Manual estimate one hour less or more");
  expect(keys).toHaveTextContent("Size and estimate");
  expect(keys).toHaveTextContent("Put it back");

  fireEvent.keyDown(bar, { key: "ArrowRight" });
  expect(dragTip()).toHaveTextContent("Sun Oct 4M, forecast ~50m. Saves when you stop pressing keys.");
  fireEvent.keyDown(bar, { key: "ArrowRight" });
  // From M's 50 minutes, an hour more is 2h.
  fireEvent.keyDown(bar, { key: "ArrowRight", shiftKey: true });
  expect(dragTip()).toHaveTextContent("Mon Oct 5Manual estimate 2h. Its size is M. Saves when you stop pressing keys.");
  expect(leftOf(bar)).toBe(OCT_1 + 4 * DAY);
  expect(widthOf(bar)).toBe(32);
  expect(actions.moveItemAction).not.toHaveBeenCalled();

  // Just short of the pause after the last key nothing is saved; at the pause the move is.
  await act(() => vi.advanceTimersByTimeAsync(KEY_DELAY - 1));
  expect(actions.moveItemAction).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(actions.moveItemAction).toHaveBeenCalledWith({ projectId: "p1", issue: 146, start: "2026-10-05", target: "2026-10-05", estimate: 2 });
  expect(await screen.findByText("Moved #146 to Oct 5")).toBeInTheDocument();
  expect(screen.getByText("Saved to GitHub. Manual estimate 2h.")).toBeInTheDocument();
  expect(actions.moveItemAction).toHaveBeenCalledTimes(1);

  // Escape puts back a move that is not saved yet; E opens the size popover.
  fireEvent.keyDown(bar, { key: "ArrowLeft" });
  fireEvent.keyDown(bar, { key: "Escape" });
  expect(dragTip()).not.toBeInTheDocument();
  fireEvent.keyDown(bar, { key: "e" });
  expect(await screen.findByRole("dialog", { name: "Size and estimate of #146" })).toBeInTheDocument();
  await act(() => vi.advanceTimersByTimeAsync(KEY_DELAY));
  expect(actions.moveItemAction).toHaveBeenCalledTimes(1);
});

test("an unscheduled task with a size drags onto the chart and one without has its grip off with the reason", async () => {
  renderSized();
  const block = screen.getByRole("region", { name: "Unscheduled" });
  const off = within(block).getByRole("button", { name: "Set a size or an estimate to drag #152 onto the chart" });
  expect(off).toHaveAttribute("aria-disabled", "true");
  fireEvent.pointerDown(off, { pointerId: 1, button: 0, clientX: 20, clientY: 700 });
  expect(within(block).queryByText("Placing")).not.toBeInTheDocument();

  // The chart's rows end 600 px down; the label column is 280 px wide.
  const grid = screen.getByRole("grid", { name: "Timeline" });
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 280 + 60 * DAY, height: 600 }));
  const grip = within(block).getByRole("button", { name: "Drag #153 onto the chart" });
  fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientX: 20, clientY: 700 });
  expect(within(block).getByText("Placing")).toBeInTheDocument();

  // Over Sunday Oct 4 its bar shows in its own row, after #149's two hours.
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 280 + OCT_1 + 3 * DAY + 10, clientY: 300 });
  expect(dragTip()).toHaveTextContent("Sun Oct 4S, forecast ~25m. Target Oct 4");
  expect(leftOf(barOf(153))).toBe(OCT_1 + 3 * DAY + 32);
  // Off the chart there is nowhere to drop.
  fireEvent.pointerMove(document, { pointerId: 1, clientX: 280 + OCT_1 + 3 * DAY + 10, clientY: 650 });
  expect(dragTip()).not.toBeInTheDocument();
  expect(within(row(/^Task #153 /)).queryByRole("link", { name: /^Task #153 / })).not.toBeInTheDocument();

  fireEvent.pointerMove(document, { pointerId: 1, clientX: 280 + OCT_1 + 3 * DAY + 10, clientY: 300 });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: 280 + OCT_1 + 3 * DAY + 10, clientY: 300 });
  await waitFor(() => expect(actions.moveItemAction).toHaveBeenCalledWith({ projectId: "p1", issue: 153, start: "2026-10-04", target: "2026-10-04" }));
  expect(await screen.findByText("Moved #153 to Oct 4")).toBeInTheDocument();
  expect(within(block).queryByText(/#153/)).not.toBeInTheDocument();
  expect(barOf(153)).toBeInTheDocument();
});

/** The sized plan with some tasks changed. */
const sizedWith = (changes: Record<number, Partial<PlanTask>>) =>
  planView(sized.epics.map((e) => ({ ...e, stories: e.stories.map((s) => ({ ...s, tasks: s.tasks.map((t) => ({ ...t, ...changes[t.number] })) })) })));

test("the load row shows hours per day and marks a day over capacity", () => {
  // #145 with a manual 4 hours and #149 with 5: Oct 3 holds the last 3 of #143's 9 hours and 3 of #145's, and
  // Oct 4 #145's last hour, #146's 50 minutes and #149's 5 hours.
  renderSized({ plan: sizedWith({ 145: { estimate: 4 }, 149: { estimate: 5 }, 152: { start: "2026-10-05", target: "2026-10-06" } }) });
  const axis = screen.getByRole("row", { name: "Time axis" });
  const label = within(axis).getByRole("button", { name: "Load at 6h a day" });
  expect(label).toHaveAttribute("title", "1 task with dates has no size, so its hours are not counted");

  expect(within(axis).getByTitle("Oct 1: 1h 15m of 6h")).not.toHaveAttribute("data-over");
  expect(within(axis).getByTitle("Oct 2: 6h of 6h")).not.toHaveAttribute("data-over");
  expect(within(axis).getByTitle("Oct 3: 6h of 6h")).not.toHaveAttribute("data-over");
  const over = within(axis).getByTitle("Oct 4: 6h 50m of 6h");
  expect(over).toHaveAttribute("data-over", "true");
  expect(over).toHaveTextContent("6h 50m");
  expect(within(axis).queryByTitle(/^Oct 5:/)).not.toBeInTheDocument();
});

test("the load row's label opens the capacity popover, which saves the project's hours a day", async () => {
  renderSized();
  fireEvent.click(within(screen.getByRole("row", { name: "Time axis" })).getByRole("button", { name: "Load at 6h a day" }));
  const popover = screen.getByRole("dialog", { name: "Capacity" });
  fireEvent.change(within(popover).getByLabelText("Hours a day"), { target: { value: "8" } });
  fireEvent.click(within(popover).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.setCapacityAction).toHaveBeenCalledWith({ projectId: "p1", hours: 8 }));
});

test("strips start under the bar at its scale and the hover card gives clock times", async () => {
  // #142's run has gone 1h 40m against M's 50 minutes; an earlier run took an hour.
  const runs: TimelineRun[] = [
    { id: "a1b2c3d4-0000-4000-8000-000000000001", status: "failed", issues: [142], startedAt: "2026-10-01T08:00:00Z", finishedAt: "2026-10-01T09:00:00Z" },
    { id: "e5f6a7b8-0000-4000-8000-000000000002", status: "running", issues: [142], startedAt: "2026-10-02T10:20:00Z", finishedAt: null },
  ];
  const { container } = renderSized({ runs });
  const bar = barOf(142);
  // After #141's 25 minutes on Oct 1.
  expect(leftOf(bar)).toBeCloseTo(OCT_1 + 6.67, 1);

  const [running, failed] = within(row(/^Task #142 /)).getAllByRole("link", { name: /^Run / });
  expect(leftOf(running!)).toBeCloseTo(leftOf(bar), 5);
  expect(widthOf(running!)).toBeCloseTo(13.33, 1);
  expect(leftOf(failed!)).toBeCloseTo(leftOf(bar), 5);
  expect(widthOf(failed!)).toBeCloseTo(13.33, 1);
  // What runs past the duration is the overrun: 50 minutes and 10 minutes.
  const overruns = [...container.querySelectorAll<HTMLElement>("[data-overrun]")];
  expect(overruns.map((o) => Math.round(widthOf(o) * 100) / 100)).toEqual([13.33, 2.67]);
  expect(leftOf(overruns[0]!)).toBeCloseTo(leftOf(bar) + 13.33, 1);

  // Over forecast replaces Overdue while the run is active.
  expect(within(row(/^Task #142 /)).getByRole("button", { name: "Over forecast by 50m" })).toBeInTheDocument();

  fireEvent.focus(bar);
  const card = await screen.findByText("#142 R2 Geist type");
  const details = card.closest<HTMLElement>("[data-slot=hover-card-content]")!;
  const at = (iso: string) => {
    const d = new Date(iso);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  expect(details).toHaveTextContent("SizeM");
  expect(details).toHaveTextContent("Forecast~50m, the median of 12 finished M runsagent 30m, queue 5m, waiting on you 15m, about $0.90");
  expect(details).toHaveTextContent("Actual1h 40m so far, 50m over");
  expect(details).toHaveTextContent(`${at("2026-10-02T10:20:00Z")} to now`);
  expect(details).toHaveTextContent(`${at("2026-10-01T08:00:00Z")} to ${at("2026-10-01T09:00:00Z").split(", ")[1]}`);
});

/**
 * The sized plan for Arrange: in Unscheduled #152 has a manual 4 hours and waits on #153 (S, ~25m), and #154 has
 * neither a size nor an estimate. Today, Oct 2, is full with #143; Oct 3 holds #143's last 3 hours and then #145 and #146 (4h 40m), and Oct 4
 * #149's 2 hours.
 */
const arranging = planView(
  sized.epics.map((e) => ({
    ...e,
    stories: e.stories.map((s) =>
      s.number !== 126 ? s : { ...s, tasks: [...s.tasks.map((t) => (t.number === 152 ? { ...t, estimate: 4, blockedBy: [153] } : t)), task(154, "Restyle the 404 page", "Shaping", { parent: 126 })] },
    ),
  })),
);
/** #152 in the preview: after #153's 25 minutes on Oct 3, 5h 5m in at 16 px an hour. */
const AT_152 = OCT_1 + 2 * DAY + (305 / 60) * 16;
const unscheduledRow = (n: number) => within(screen.getByRole("region", { name: "Unscheduled" })).getByRole("listitem", { name: new RegExp(`^Task #${n} `) });

test("Arrange shows a preview of the placed tasks and writes nothing until Save", () => {
  renderSized({ plan: arranging });
  const arrange = within(screen.getByRole("region", { name: "Unscheduled" })).getByRole("button", { name: "Arrange by estimate" });
  expect(arrange).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(arrange);
  expect(arrange).toHaveAttribute("aria-pressed", "true");

  const banner = screen.getByRole("region", { name: "Arrange preview" });
  expect(banner).toHaveTextContent("Preview: 2 tasks, Oct 3 to Oct 4");
  expect(banner).toHaveTextContent(
    "From today, in blocker order, up to 6h a day after the work already planned. Each task uses its manual estimate, or else its size forecast. #154 has no size and no estimate and stays unscheduled.",
  );
  expect(within(banner).getByRole("button", { name: "Save 2 tasks to GitHub" })).toBeInTheDocument();

  // #153 fits after #145 and #146 on Oct 3, 4h 40m in. #152 follows its blocker there for Oct 3's last 55 minutes
  // and runs 3h 5m into Oct 4, beside #149's 2 hours.
  const first = barOf(153);
  expect(first).toHaveAttribute("data-preview", "true");
  expect(first).toHaveAccessibleName(/, Oct 3, in preview$/);
  expect(leftOf(first)).toBeCloseTo(OCT_1 + 2 * DAY + (280 / 60) * 16, 1);
  const second = barOf(152);
  expect(second).toHaveAccessibleName(/manual estimate 4 hours, Oct 3 to Oct 4, blocked by #153, in preview$/);
  expect(leftOf(second)).toBeCloseTo(AT_152, 1);
  expect(widthOf(second)).toBe(64);
  expect(within(row(/^Task #153 /)).getByText("Oct 3")).toBeInTheDocument();
  expect(within(row(/^Task #152 /)).getByText("Oct 3 to Oct 4")).toBeInTheDocument();

  // The load counts the preview with the work already planned.
  const axis = screen.getByRole("row", { name: "Time axis" });
  expect(within(axis).getByTitle("Oct 3: 6h of 6h, 1h 20m of it in the preview")).toBeInTheDocument();
  expect(within(axis).getByTitle("Oct 4: 5h 5m of 6h, 3h 5m of it in the preview")).toBeInTheDocument();

  // The tasks stay in Unscheduled, tagged, until Save.
  expect(within(unscheduledRow(152)).getByText("In preview")).toBeInTheDocument();
  expect(within(unscheduledRow(153)).getByText("In preview")).toBeInTheDocument();
  expect(within(unscheduledRow(154)).getByText("Needs a size")).toBeInTheDocument();
  expect(actions.saveArrangeAction).not.toHaveBeenCalled();
  expect(actions.moveItemAction).not.toHaveBeenCalled();
});

test("Save writes Start and Target for each task and Cancel leaves them unscheduled", async () => {
  const { unmount } = renderSized({ plan: arranging });
  const arrangeButton = () => within(screen.getByRole("region", { name: "Unscheduled" })).getByRole("button", { name: "Arrange by estimate" });

  // Cancel: the preview goes and nothing is written.
  fireEvent.click(arrangeButton());
  fireEvent.click(within(screen.getByRole("region", { name: "Arrange preview" })).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("region", { name: "Arrange preview" })).not.toBeInTheDocument();
  expect(within(row(/^Task #153 /)).queryByRole("link", { name: /^Task #153 / })).not.toBeInTheDocument();
  expect(within(unscheduledRow(153)).queryByText("In preview")).not.toBeInTheDocument();
  expect(arrangeButton()).toHaveAttribute("aria-pressed", "false");

  // Save: both tasks' dates in one write, and their bars stay where the preview put them.
  fireEvent.click(arrangeButton());
  fireEvent.click(screen.getByRole("button", { name: "Save 2 tasks to GitHub" }));
  expect(await screen.findByText("Saving 2 tasks to GitHub")).toBeInTheDocument();
  await waitFor(() =>
    expect(actions.saveArrangeAction).toHaveBeenCalledWith({
      projectId: "p1",
      items: [
        { issue: 153, start: "2026-10-03", target: "2026-10-03" },
        { issue: 152, start: "2026-10-03", target: "2026-10-04" },
      ],
    }),
  );
  expect(await screen.findByText("Arranged 2 tasks")).toBeInTheDocument();
  expect(screen.getByText("Saved Start and Target to GitHub.")).toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Arrange preview" })).not.toBeInTheDocument();
  expect(barOf(153)).not.toHaveAttribute("data-preview");
  expect(leftOf(barOf(152))).toBeCloseTo(AT_152, 1);
  expect(within(screen.getByRole("region", { name: "Unscheduled" })).queryByRole("listitem", { name: /^Task #15[23] / })).not.toBeInTheDocument();
  expect(unscheduledRow(154)).toBeInTheDocument();
  expect(actions.saveArrangeAction).toHaveBeenCalledTimes(1);
  expect(actions.moveItemAction).not.toHaveBeenCalled();
  unmount();
  toast.dismiss();

  // A task GitHub refuses goes back to Unscheduled and the toast names it; the other stays saved.
  actions.saveArrangeAction.mockResolvedValueOnce({ ok: true, saved: [153], refused: [{ issue: 152, reason: "it is not in the Project" }] });
  renderSized({ plan: arranging });
  fireEvent.click(arrangeButton());
  fireEvent.click(screen.getByRole("button", { name: "Save 2 tasks to GitHub" }));
  expect(await screen.findByText("GitHub did not take #152")).toBeInTheDocument();
  expect(screen.getByText("#152: it is not in the Project. #153 is saved.")).toBeInTheDocument();
  expect(barOf(153)).toBeInTheDocument();
  expect(within(row(/^Task #152 /)).queryByRole("link", { name: /^Task #152 / })).not.toBeInTheDocument();
  expect(unscheduledRow(152)).toBeInTheDocument();
});

test("Arrange is off when no unscheduled task has a size or an estimate", async () => {
  // #153 loses its size, and #152 has none: Unscheduled holds only tasks without a duration.
  const { unmount } = renderSized({ plan: sizedWith({ 153: { size: undefined } }) });
  const arrange = within(screen.getByRole("region", { name: "Unscheduled" })).getByRole("button", { name: "Arrange by estimate" });
  expect(arrange).toHaveAttribute("aria-disabled", "true");
  fireEvent.focus(arrange);
  expect(await screen.findByRole("tooltip")).toHaveTextContent("No unscheduled task here has a size or an estimate");

  fireEvent.click(arrange);
  expect(screen.queryByRole("region", { name: "Arrange preview" })).not.toBeInTheDocument();
  expect(arrange).toHaveAttribute("aria-pressed", "false");

  // Without the Plan page's sizes there is nothing to arrange by, so there is no button.
  unmount();
  renderTimeline();
  expect(within(screen.getByRole("region", { name: "Unscheduled" })).queryByRole("button", { name: "Arrange by estimate" })).not.toBeInTheDocument();
});

/**
 * The design's Redesign beta, due Saturday Oct 3: epic #120 sets it, so its stories and tasks are in it. #148 and #149
 * end on Oct 4, a day late; #152 has no dates.
 */
const redesign = planView([
  epic(
    120,
    "Refined product redesign",
    [
      story(125, "Redesign foundations", 120, [task(141, "Tokens", "Done", { state: "closed", start: "2026-10-01", target: "2026-10-01" }), task(152, "Document the workflow", "Shaping")]),
      story(128, "Restyle the task page", 120, [
        task(143, "Restyle the sidebar", "Ready", { start: "2026-10-02", target: "2026-10-03" }),
        task(148, "Restyle the task page", "Shaping", { start: "2026-10-03", target: "2026-10-04" }),
        task(149, "Restyle dialogs", "Shaping", { start: "2026-10-04", target: "2026-10-04" }),
      ]),
    ],
    [],
    { milestone: { number: 1, title: "Redesign beta" } },
  ),
]);

function renderRedesign(dueOn: string) {
  const timeline = timelineOf(redesign, [], NOW);
  const plan = withMilestones(redesign, [milestone(1, "Redesign beta", { dueOn })], { timeline });
  return render(
    <PlanTimeline
      projectId="p1"
      repoUrl={REPO_URL}
      project={PROJECT_WITH_DATES}
      epics={plan.epics}
      unparented={[]}
      timeline={timeline}
      zoom="days"
      filters={parsePlanFilters({ milestone: "1" })}
      milestone={plan.milestones![0]}
      needsYou={[]}
      graphs={["loop"]}
      graphName="loop"
      readAt={NOW.getTime()}
    />,
    { wrapper: TooltipProvider },
  );
}

test("filtered to a milestone, the timeline draws its due date as a dashed line with a flag, hatches the days past it and names the tasks that end after it", () => {
  const { container } = renderRedesign("2026-10-03");
  const grid = screen.getByRole("grid", { name: "Timeline" });
  const flag = within(grid).getByText("Redesign beta, due Oct 3");
  expect(flag).toHaveAttribute("data-late");
  expect(flag).toHaveAttribute("title", "Redesign beta is due Oct 3. Its last task ends Oct 4.");
  // The line sits at the end of the due day, where #149's bar on Oct 4 starts; the hatch covers Oct 4.
  const lines = container.querySelectorAll<HTMLElement>("[data-due-line]");
  expect(lines).toHaveLength(2);
  const oct4 = within(row(/Task #149/)).getByRole("link", { name: /^Task #149/ });
  for (const line of lines) expect(line.style.left).toBe(oct4.style.left);
  const hatch = container.querySelector<HTMLElement>("[data-past-due]")!;
  expect(hatch.style.left).toBe(oct4.style.left);
  expect(hatch.style.width).toBe(oct4.style.width);
  expect(within(grid).getByText("Ends Oct 4, 1 day late")).toBeInTheDocument();

  expect(within(row(/Task #148/)).getByText("Ends after Oct 3")).toBeInTheDocument();
  expect(within(row(/Task #149/)).getByText("Ends after Oct 3")).toBeInTheDocument();
  expect(within(row(/Task #143/)).queryByText("Ends after Oct 3")).not.toBeInTheDocument();
  expect(within(row(/Task #141/)).queryByText("Ends after Oct 3")).not.toBeInTheDocument();
});

test("a milestone the plan ends early has its line and flag with no hatch, and without the filter there is no line", () => {
  const { container, unmount } = renderRedesign("2026-10-07");
  const flag = screen.getByText("Redesign beta, due Oct 7");
  expect(flag).not.toHaveAttribute("data-late");
  expect(flag).toHaveAttribute("title", "Redesign beta is due Oct 7. Its last task ends Oct 4.");
  expect(container.querySelectorAll("[data-due-line]")).toHaveLength(2);
  expect(container.querySelector("[data-past-due]")).toBeNull();
  expect(screen.queryByText(/Ends after/)).not.toBeInTheDocument();
  unmount();

  const again = renderTimeline({ plan: redesign });
  expect(again.container.querySelector("[data-due-line]")).toBeNull();
  expect(screen.queryByText(/due Oct/)).not.toBeInTheDocument();
});

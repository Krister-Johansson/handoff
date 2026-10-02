import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { TimelineRun } from "@/lib/plan/schedule";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parsePlanFilters } from "@/lib/plan/filters";

import { PlanTimeline } from "./plan-timeline";
import { epic, planView, PROJECT, REPO_URL, run, story, task, timelineOf } from "./testing/plan-fixtures";

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

function renderTimeline(over: { runs?: TimelineRun[]; zoom?: "weeks" | "months"; project?: typeof PROJECT; plan?: typeof view; needsYou?: string[] } = {}) {
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

test("a Project without date fields shows the banner and Add date fields", async () => {
  const { unmount } = renderTimeline();
  expect(screen.queryByText("This Project has no Start and Target fields")).not.toBeInTheDocument();
  unmount();

  actions.addDateFieldsAction.mockResolvedValueOnce({ ok: false, error: "GitHub refused the field." });
  renderTimeline({ project: { ...PROJECT, dateFields: { start: "f-start", target: undefined } } });
  const banner = screen.getByRole("alert");
  expect(within(banner).getByText("This Project has no Start and Target fields")).toBeInTheDocument();
  expect(within(banner).getByText('GitHub\'s roadmap also needs them picked once under "Date fields".')).toBeInTheDocument();

  fireEvent.click(within(banner).getByRole("button", { name: "Add date fields" }));
  const confirm = await screen.findByRole("alertdialog", { name: "Add Start and Target to handoff plan?" });
  expect(actions.addDateFieldsAction).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole("button", { name: "Add date fields" }));
  await waitFor(() => expect(actions.addDateFieldsAction).toHaveBeenCalledWith({ projectId: "p1" }));
  expect(await within(confirm).findByText("GitHub refused the field.")).toBeInTheDocument();

  fireEvent.click(within(confirm).getByRole("button", { name: "Add date fields" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(actions.addDateFieldsAction).toHaveBeenCalledTimes(2);
});

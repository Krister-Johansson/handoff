import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parsePlanFilters } from "@/lib/plan/filters";
import { PlanTimeline } from "./plan-timeline";
import { Sizing } from "./plan-context";
import { epic, planView, PROJECT, REPO_URL, sizedTimelineOf, sizingOf, story, task, timelineOf } from "./testing/plan-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({
  moveToReadyAction: vi.fn(),
  moveToShapingAction: vi.fn(),
  startRunAction: vi.fn(),
  listIssuesAction: vi.fn(),
  scheduleAction: vi.fn(),
  addDateFieldsAction: vi.fn(),
  setSizeAction: vi.fn(),
  moveItemAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
}));
vi.mock("@/app/projects/actions", () => actions);

const wide = window.matchMedia;
beforeEach(() => {
  window.matchMedia = (query: string) =>
    ({ matches: query === "(max-width: 639px)", media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
});
afterEach(() => {
  window.matchMedia = wide;
});

const NOW = new Date("2026-10-02T12:00:00Z");

test("under 640 px the timeline lists items with their dates, and a warning icon after a title names what it waits on instead of arrows", () => {

  const view = planView([
    epic(12, "Project management", [
      story(41, "Shaping with the assistant", 12, [
        task(55, "Shaping tools", "Running", { start: "2026-09-30", target: "2026-10-07" }),
        task(57, "Add the migration", "Shaping", { start: "2026-10-01", target: "2026-10-09", blockedBy: [55] }),
        task(58, "Plan page tree and board", "Ready"),
      ]),
    ]),
    epic(10, "Voice", [story(18, "Voice settings", 10, [task(70, "Speak replies", "Running", { start: "2026-09-14", target: "2026-10-09" }), task(72, "Voice picker", "Ready", { start: "2026-10-12", target: "2026-10-16", blockedBy: [70] })])]),
  ]);
  const runs = [{ id: "b7710e42-0000-4000-8000-000000000002", status: "running", issues: [55], startedAt: "2026-10-01T12:00:00Z", finishedAt: null }];
  const { container } = render(
    <PlanTimeline
      projectId="p1"
      repoUrl={REPO_URL}
      project={{ ...PROJECT, dateFields: { start: "s", target: "t" } }}
      epics={view.epics}
      unparented={[]}
      timeline={timelineOf(view, runs, NOW)}
      zoom={undefined}
      filters={parsePlanFilters({})}
      needsYou={[]}
      graphs={["loop"]}
      graphName="loop"
      readAt={NOW.getTime()}
    />,
    { wrapper: TooltipProvider },
  );

  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  expect(container.querySelector("[data-arrow]")).toBeNull();

  const list = screen.getByRole("list", { name: "Timeline" });
  const items = within(list).getAllByRole("listitem");
  expect(items.map((i) => i.getAttribute("aria-label"))).toEqual([
    "Epic #12 Project management",
    "Story #41 Shaping with the assistant",
    "Task #55 Shaping tools",
    "Task #57 Add the migration",
    "Task #58 Plan page tree and board",
    "Epic #10 Voice",
    "Story #18 Voice settings",
    "Task #70 Speak replies",
    "Task #72 Voice picker",
  ]);
  const item = (name: RegExp) => within(list).getByRole("listitem", { name });

  expect(within(item(/Story #41/)).getByText("Sep 30 to Oct 9")).toBeInTheDocument();
  expect(within(item(/Story #41/)).getByText("0 of 3 done")).toBeInTheDocument();
  expect(within(item(/Task #55/)).getByText("Run Oct 1 to now")).toBeInTheDocument();
  expect(within(item(/Task #57/)).getByText("Oct 1 to Oct 9")).toBeInTheDocument();
  expect(within(item(/Task #57/)).getByRole("button", { name: "Late: waiting on #55" })).toBeInTheDocument();
  expect(within(item(/Task #57/)).queryByText("Late: waiting on #55")).not.toBeInTheDocument();
  expect(within(item(/Task #57/)).getByText("No runs")).toBeInTheDocument();
  expect(within(item(/Task #72/)).getByRole("button", { name: "Blocked by #70" })).toBeInTheDocument();
  expect(within(item(/Task #58/)).getByText("No dates")).toBeInTheDocument();
  expect(within(item(/Task #58/)).getByRole("button", { name: "Schedule #58 Plan page tree and board" })).toBeInTheDocument();
});

test("under 640 px the warning icon opens the same card on focus, with the blocker linked to its issue, and Escape closes it", async () => {
  const view = planView([
    epic(12, "Project management", [
      story(41, "Shaping with the assistant", 12, [
        task(55, "Shaping tools", "Running", { start: "2026-09-30", target: "2026-10-07" }),
        task(57, "Add the migration", "Shaping", { start: "2026-10-01", target: "2026-10-09", blockedBy: [55] }),
      ]),
    ]),
  ]);
  render(
    <PlanTimeline
      projectId="p1"
      repoUrl={REPO_URL}
      project={{ ...PROJECT, dateFields: { start: "s", target: "t" } }}
      epics={view.epics}
      unparented={[]}
      timeline={timelineOf(view, [], NOW)}
      zoom={undefined}
      filters={parsePlanFilters({})}
      needsYou={[]}
      graphs={["loop"]}
      graphName="loop"
      readAt={NOW.getTime()}
    />,
    { wrapper: TooltipProvider },
  );
  const icon = within(screen.getByRole("listitem", { name: "Task #57 Add the migration" })).getByRole("button", { name: "Late: waiting on #55" });

  fireEvent.focus(icon);
  const card = await screen.findByRole("group", { name: "Flags of #57 Add the migration" });
  expect(within(card).getAllByRole("definition")[0]).toHaveTextContent("Start was Oct 1; waits on #55");
  const blocker = within(card).getByRole("listitem", { name: "#55 Shaping tools" });
  expect(within(blocker).getByRole("link", { name: "#55 Shaping tools" })).toHaveAttribute("href", "/projects/p1/issues/55");
  expect(within(blocker).getByText("Running")).toBeInTheDocument();
  expect(within(blocker).getByText("Open")).toBeInTheDocument();

  fireEvent.keyDown(icon, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("group", { name: /^Flags of/ })).not.toBeInTheDocument());
});

test("under 640 px a task shows its size and a Start field whose Target follows the duration", async () => {
  const view = planView([
    epic(120, "Refined product redesign", [
      story(127, "Restyle project views", 120, [
        task(141, "R1 Redesign tokens", "Running", { start: "2026-10-02", target: "2026-10-02", size: "S" }),
        task(143, "R3 Restyle the sidebar", "Ready", { start: "2026-10-02", target: "2026-10-03", size: "L", estimate: 9 }),
        task(146, "R6 Restyle the list view", "Shaping", { start: "2026-10-03", target: "2026-10-03", size: "M", blockedBy: [143] }),
        task(152, "Document the workflow", "Shaping"),
      ]),
    ]),
  ]);
  render(
    <Sizing value={sizingOf()}>
      <PlanTimeline
        projectId="p1"
        repoUrl={REPO_URL}
        project={{ ...PROJECT, dateFields: { start: "s", target: "t" } }}
        epics={view.epics}
        unparented={[]}
        timeline={sizedTimelineOf(view, [], NOW)}
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
  const item = (name: RegExp) => screen.getByRole("listitem", { name });
  expect(within(item(/Task #146/)).getByRole("button", { name: "Size M, forecast 50m. Change the size or estimate of #146" })).toBeInTheDocument();
  expect(within(item(/Task #143/)).getByRole("button", { name: "Size L, manual estimate 1.5d. Change the size or estimate of #143" })).toBeInTheDocument();

  fireEvent.click(within(item(/Task #146/)).getByRole("button", { name: "Start of #146, Oct 3. Change" }));
  const form = within(item(/Task #146/)).getByRole("group", { name: "New start for #146" });
  expect(within(form).getByLabelText("Start")).toHaveValue("2026-10-03");
  expect(within(form).getByText("Target follows from the M forecast, ~50m: Oct 3.")).toBeInTheDocument();
  expect(within(form).getByText("Blocked by #143, planned to end Oct 3.")).toBeInTheDocument();

  fireEvent.change(within(form).getByLabelText("Start"), { target: { value: "2026-10-06" } });
  expect(within(form).getByText("Target follows from the M forecast, ~50m: Oct 6.")).toBeInTheDocument();
  fireEvent.click(within(form).getByRole("button", { name: "Save to GitHub" }));
  await waitFor(() => expect(actions.moveItemAction).toHaveBeenCalledWith({ projectId: "p1", issue: 146, start: "2026-10-06", target: "2026-10-06" }));
  await waitFor(() => expect(within(item(/Task #146/)).queryByRole("group", { name: "New start for #146" })).not.toBeInTheDocument());

  // A manual estimate counts in days of the capacity; a task with neither keeps Schedule. Nothing drags here.
  fireEvent.click(within(item(/Task #143/)).getByRole("button", { name: "Start of #143, Oct 2. Change" }));
  expect(within(item(/Task #143/)).getByText("Target follows from the manual estimate, 1.5d: Oct 3.")).toBeInTheDocument();
  expect(within(item(/Task #152/)).getByRole("button", { name: "Schedule #152 Document the workflow" })).toBeInTheDocument();
  expect(within(item(/Task #152/)).queryByRole("button", { name: /^Start of/ })).not.toBeInTheDocument();
  // A Running task keeps its dates: its run owns it.
  expect(within(item(/Task #141/)).getByRole("button", { name: "Size S, forecast 25m. Change the size or estimate of #141" })).toBeInTheDocument();
  expect(within(item(/Task #141/)).queryByRole("button", { name: /^Start of/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /^Task #/ })).not.toBeInTheDocument();
});

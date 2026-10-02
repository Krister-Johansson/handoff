import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parsePlanFilters } from "@/lib/plan/filters";
import { PlanTimeline } from "./plan-timeline";
import { epic, planView, PROJECT, REPO_URL, story, task, timelineOf } from "./testing/plan-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn(), scheduleAction: vi.fn(), addDateFieldsAction: vi.fn() }));

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

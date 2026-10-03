import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlanFlow } from "./plan-flow";
import { epic, flowOf, flowRun, planView, REPO_URL, story, task } from "./testing/plan-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn() }));

const wide = window.matchMedia;
beforeEach(() => {
  window.matchMedia = (query: string) =>
    ({ matches: query === "(max-width: 639px)", media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;
});
afterEach(() => {
  window.matchMedia = wide;
});

test("under 640 px the Flow is a list in order with lane and Next tags", () => {
  const view = planView([
    epic(12, "Project management", [
      story(41, "Shaping with the assistant", 12, [
        task(55, "Shaping tools", "Running", { size: "L" }),
        task(56, "Approval cards", "Running", { size: "S" }),
        task(57, "Add the migration", "Ready", { size: "S", blockedBy: [55] }),
        task(58, "Plan page tree and board", "Ready", { size: "M" }),
        task(63, "Release notes", "Ready", { size: "S", labels: ["task", "human"] }),
        task(64, "Board filters", "Shaping", { size: "S" }),
        task(69, "Transcript strip", "Done", { state: "closed" }),
      ]),
    ]),
  ]);
  render(
    <TooltipProvider>
      <PlanFlow
        projectId="p1"
        repoUrl={REPO_URL}
        epics={view.epics}
        unparented={[]}
        flow={flowOf(view, { lanes: 2, runs: [flowRun(55, 0, 3, 7), flowRun(56, 5, 5, 7, { waitsOn: "Waits on you: review" })] })}
        scheduler={{ state: "running", claudeSlots: 1 }}
        graphs={["loop"]}
        graphName="loop"
      />
    </TooltipProvider>,
  );

  expect(screen.queryByRole("grid", { name: "Flow" })).not.toBeInTheDocument();
  expect(screen.getByText("2 runs at once, 1 Claude slot")).toBeInTheDocument();
  const list = screen.getByRole("list", { name: "Flow" });
  const items = within(list).getAllByRole("listitem");
  // The running tasks by slot, then the order: Ready, then Shaping; the skipped last. A done task is not listed.
  expect(items.map((li) => li.getAttribute("aria-label"))).toEqual([
    "Task #55 Shaping tools",
    "Task #56 Approval cards",
    "Task #57 Add the migration",
    "Task #58 Plan page tree and board",
    "Task #64 Board filters",
    "Task #63 Release notes",
  ]);
  const item = (n: number) => items.find((li) => li.getAttribute("aria-label")?.startsWith(`Task #${n} `))!;
  expect(within(item(55)).getByText("Slot 1")).toBeInTheDocument();
  expect(within(item(55)).getByText("3 of 7 steps")).toBeInTheDocument();
  expect(within(item(56)).getByText("Slot 2")).toBeInTheDocument();
  expect(within(item(56)).getByText("Waits on you: review")).toBeInTheDocument();
  // #57 is Next 1 but waits for #55, so #58 starts first in slot 2, which frees first, and #57 takes slot 1 after #55.
  expect(within(item(57)).getByText("Next 1")).toBeInTheDocument();
  expect(within(item(57)).getByText("Slot 1")).toBeInTheDocument();
  expect(within(item(58)).getByText("Next 2")).toBeInTheDocument();
  expect(within(item(58)).getByText("Slot 2")).toBeInTheDocument();
  expect(within(item(64)).getByText("Shaping")).toBeInTheDocument();
  expect(within(item(63)).getByText("Skipped: label human")).toBeInTheDocument();
  expect(within(item(63)).getByText("Not in the order")).toBeInTheDocument();
  // The list does not reorder.
  expect(screen.queryByRole("button", { name: /Move/ })).not.toBeInTheDocument();
});

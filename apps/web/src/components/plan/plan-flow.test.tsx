import { render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { FlowInput } from "@/lib/plan/flow";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PlanFlow } from "./plan-flow";
import { epic, flowOf, flowRun, planView, REPO_URL, story, task } from "./testing/plan-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn() }));

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

/**
 * The design's plan: three lanes; #55, #70 and #56 run, #56 waiting for a review. #57 waits for #55 and #62
 * for #61; #63 has the human label and #66 a cancelled latest run; #69 is done.
 */
const view = planView([
  epic(12, "Project management", [
    story(41, "Shaping with the assistant", 12, [
      task(55, "Shaping tools in the catalog", "Running", { size: "L" }),
      task(56, "Approval card summaries", "Running", { size: "S" }),
      task(57, "Add the migration", "Ready", { size: "S", blockedBy: [55] }),
      task(58, "Plan page tree and board", "Ready", { size: "M" }),
    ]),
    story(43, "Plan views", 12, [
      task(61, "Story page with its tasks", "Ready", { size: "M" }),
      task(62, "Size chip on board cards", "Ready", { size: "M", blockedBy: [61] }),
      task(60, "Ready count in the sidebar", "Ready", { size: "S" }),
      task(63, "Write the release notes", "Ready", { size: "S", labels: ["task", "human"] }),
      task(66, "Import a plan from a CSV file", "Ready", { size: "M" }),
    ]),
  ]),
  epic(10, "Voice", [
    story(18, "Voice settings", 10, [
      task(69, "Transcript strip", "Done", { state: "closed", size: "S" }),
      task(70, "Speak replies with a Stop control", "Running", { size: "M" }),
      task(72, "Voice picker", "Ready", { size: "S", blockedBy: [70] }),
      task(74, "Voice errors in the transcript strip", "Ready", { size: "S" }),
    ]),
  ]),
]);

const designFlow = (over: Partial<FlowInput> = {}) =>
  flowOf(view, {
    lanes: 3,
    runs: [flowRun(55, 0, 3, 7), flowRun(70, 5, 3, 7), flowRun(56, 10, 5, 7, { waitsOn: "Waits on you: review" })],
    latest: new Map([[66, { id: "r66", status: "cancelled" }]]),
    ...over,
  });

type Props = ComponentProps<typeof PlanFlow>;
function renderFlow(over: Partial<Props> = {}) {
  const props: Props = {
    projectId: "p1",
    repoUrl: REPO_URL,
    epics: view.epics,
    unparented: [],
    flow: designFlow(),
    scheduler: { state: "running", claudeSlots: 3 },
    graphs: ["loop"],
    graphName: "loop",
    ...over,
  };
  return render(
    <TooltipProvider>
      <PlanFlow {...props} />
    </TooltipProvider>,
  );
}

const rowOf = (name: string) => screen.getByRole("row", { name });
const leftOf = (el: HTMLElement) => parseFloat(el.style.left);

test("each task's card sits on its row in its lane, with its Next tag", () => {
  renderFlow();
  const grid = screen.getByRole("grid", { name: "Flow" });
  expect(within(grid).getByText("3 runs at once, 3 Claude slots")).toBeInTheDocument();

  // #58 starts first, in slot 3, which frees first; #61 follows in slot 2 when #70 ends.
  const row58 = rowOf("Task #58 Plan page tree and board");
  const card58 = within(row58).getByRole("link", { name: "#58 Plan page tree and board, Next 2, slot 3" });
  expect(within(row58).getByText("Next 2")).toBeInTheDocument();
  const card61 = within(rowOf("Task #61 Story page with its tasks")).getByRole("link", { name: "#61 Story page with its tasks, Next 3, slot 2" });
  expect(leftOf(card61)).toBeGreaterThan(leftOf(card58));
  expect(within(rowOf("Task #74 Voice errors in the transcript strip")).getByRole("link", { name: "#74 Voice errors in the transcript strip, Next 7, slot 3" })).toHaveTextContent("3");
  // Each card opens its issue on GitHub; epics and stories show the span of their tasks.
  expect(card58).toHaveAttribute("href", `${REPO_URL}/issues/58`);
  expect(within(rowOf("Story #43 Plan views")).getByTitle("From its first task to its last")).toBeInTheDocument();
  // A done task has no card.
  const row69 = rowOf("Task #69 Transcript strip");
  expect(within(within(row69).getByRole("gridcell")).getByText("Done")).toBeInTheDocument();
  // The row's title links to the issue; a card's name goes on with its place.
  expect(within(row69).queryByRole("link", { name: /^#69 .*,/ })).not.toBeInTheDocument();
});

test("a running card shows its steps and a run waiting on a person has the dashed ring and the row says what it waits for", () => {
  renderFlow();
  const card55 = within(rowOf("Task #55 Shaping tools in the catalog")).getByRole("link", { name: "#55 Shaping tools in the catalog, running, 3 of 7 steps, slot 1" });
  expect(card55).toHaveTextContent("3 of 7 steps");
  expect(card55).not.toHaveAttribute("data-waiting");

  const row56 = rowOf("Task #56 Approval card summaries");
  const card56 = within(row56).getByRole("link", { name: "#56 Approval card summaries, running, 5 of 7 steps, slot 3, waits on you: review" });
  // A short card says its steps briefly.
  expect(card56).toHaveTextContent("5/7");
  expect(card56).toHaveAttribute("data-waiting", "true");
  expect(within(row56).getByText("Waits on you: review")).toBeInTheDocument();
});

test("a blocked task shows After #55 and an arrow from its blocker", () => {
  // Two lanes and one Ready task that waits for #55: slot 2 stands idle until #55 ends.
  const solo = planView([
    epic(12, "Project management", [
      story(41, "Shaping with the assistant", 12, [task(55, "Shaping tools", "Running", { size: "L" }), task(57, "Add the migration", "Ready", { size: "S", blockedBy: [55] })]),
    ]),
  ]);
  const { container } = renderFlow({ epics: solo.epics, flow: flowOf(solo, { lanes: 2, runs: [flowRun(55, 0, 0, 4)] }) });

  const row57 = rowOf("Task #57 Add the migration");
  expect(within(row57).getByText("After #55")).toBeInTheDocument();
  const card = within(row57).getByRole("link", { name: "#57 Add the migration, Next 1, slot 2" });
  const wait = within(row57).getByTitle("Waits for #55");
  expect(leftOf(wait)).toBeLessThan(leftOf(card));
  expect(container.querySelector('[data-arrow="55-57"]')).not.toBeNull();
});

test("skipped tasks show their reason and Not in the order", () => {
  renderFlow();
  const row63 = rowOf("Task #63 Write the release notes");
  expect(within(row63).getByText("Skipped: label human")).toBeInTheDocument();
  expect(within(row63).getByText("Not in the order")).toBeInTheDocument();
  expect(within(row63).queryByRole("link", { name: /^#63 .*,/ })).not.toBeInTheDocument();

  const row66 = rowOf("Task #66 Import a plan from a CSV file");
  expect(within(row66).getByText("Skipped: latest run cancelled")).toBeInTheDocument();
  expect(within(row66).getByText("Not in the order")).toBeInTheDocument();
  // The order skips them: #60 is Next 5, after #62.
  expect(within(rowOf("Task #60 Ready count in the sidebar")).getByText("Next 5")).toBeInTheDocument();
});

test("the lane strips repeat each card", () => {
  renderFlow();
  const strip = (lane: number) =>
    within(screen.getByRole("list", { name: `Slot ${lane}` }))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
  expect(strip(1)).toEqual(["#55", "#57", "#72"]);
  expect(strip(2)).toEqual(["#70", "#61", "#62"]);
  expect(strip(3)).toEqual(["#56", "#58", "#60", "#74"]);
});

test("a held scheduler shows Held with its reasons", () => {
  const { unmount } = renderFlow({ flow: designFlow({ held: ["Run 3b9e21c4 failed at coder-1"] }), scheduler: { state: "held", claudeSlots: 3 } });
  expect(screen.getByText("Held: Run 3b9e21c4 failed at coder-1")).toBeInTheDocument();
  // The first task in the order waits for the hold; the cards sit as if it cleared now.
  expect(within(rowOf("Task #57 Add the migration")).getByText("Waits for the hold")).toBeInTheDocument();
  expect(within(rowOf("Task #58 Plan page tree and board")).queryByText("Waits for the hold")).not.toBeInTheDocument();
  unmount();

  // While the scheduler is off, the header says who starts tasks.
  renderFlow({ scheduler: { state: "off", claudeSlots: 3 } });
  expect(screen.getByText("The scheduler is off: tasks start when someone starts them, in this order")).toBeInTheDocument();
  expect(screen.queryByText(/^Held/)).not.toBeInTheDocument();
});

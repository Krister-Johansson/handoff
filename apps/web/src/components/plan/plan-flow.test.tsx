import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { FlowInput } from "@/lib/plan/flow";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FlowControls } from "./flow-parts";
import { FlowSelection, useFlowSelectionState } from "./plan-context";
import { PlanFlow } from "./plan-flow";
import { KEY_DELAY } from "./use-card-drag";
import { epic, flowOf, flowRun, planView, REPO_URL, story, task } from "./testing/plan-fixtures";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({
  moveToReadyAction: vi.fn(),
  moveToShapingAction: vi.fn(),
  startRunAction: vi.fn(),
  listIssuesAction: vi.fn(),
  writeOrderAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  unpinAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
}));
vi.mock("@/app/projects/actions", () => actions);
const schedulerActions = vi.hoisted(() => ({
  switchToProjectOrderAction: vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
}));
vi.mock("@/app/projects/scheduler-actions", () => schedulerActions);

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Sonner keeps its toasts in a module; each test starts with none.
  toast.dismiss();
  vi.useRealTimers();
});

/**
 * Testing Library's waitFor and findBy advance fake timers only when they see Jest's; `vi` stands in for it, so
 * they advance Vitest's fake clock instead of waiting on the wall clock.
 */
Object.assign(globalThis, { jest: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) } });

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
      <Toaster />
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

/**
 * The design's plan with its toasts, for the drag. Its order is #57, #58, #61, #62, #60, #72 and #74. Timeouts
 * are fake: the keys' save, sonner's renders and auto close run on the fake clock, which only waitFor, findBy and
 * the test move.
 */
function renderDrag(over: Partial<Props> = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  return renderFlow(over);
}

const ORDER = [57, 58, 61, 62, 60, 72, 74];
const taskRow = (n: number) => screen.getByRole("row", { name: new RegExp(`^Task #${n} `) });
const cardOf = (n: number) => within(taskRow(n)).getByRole("link", { name: new RegExp(`^#${n} .*, (Next \\d+|running|Shaping)`) });
const dragTip = () => within(screen.getByRole("grid", { name: "Flow" })).queryByRole("status");

/** Drags a card by its body from x 500 by `dx` pixels and lets go. */
function dragBy(card: HTMLElement, dx: number) {
  fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 500 });
  fireEvent.pointerMove(card, { pointerId: 1, clientX: 500 + dx });
  fireEvent.pointerUp(card, { pointerId: 1, clientX: 500 + dx });
}

test("dragging a Ready card shows where it lands and how many cards move", () => {
  const { container } = renderDrag();
  const card = cardOf(74);
  const was = leftOf(card);

  fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 500 });
  fireEvent.pointerMove(card, { pointerId: 1, clientX: -500 });
  // To the front: #74 starts first, in slot 3, and five other cards change slots.
  expect(dragTip()).toHaveTextContent("Next 1, before #57Lands in slot 3. 5 cards move.");
  // The card shows where it lands, a dashed outline where it was, and the drop line at its new start.
  expect(leftOf(cardOf(74))).toBeLessThan(was);
  expect(leftOf(taskRow(74).querySelector<HTMLElement>("[data-ghost]")!)).toBeGreaterThan(leftOf(cardOf(74)));
  expect(leftOf(container.querySelector<HTMLElement>("[data-drop-line]")!)).toBeCloseTo(leftOf(cardOf(74)), 2);

  // Escape puts it back and saves nothing.
  fireEvent.keyDown(card, { key: "Escape" });
  expect(dragTip()).not.toBeInTheDocument();
  expect(leftOf(cardOf(74))).toBe(was);
  fireEvent.pointerUp(card, { pointerId: 1, clientX: -500 });
  expect(actions.writeOrderAction).not.toHaveBeenCalled();
  // The click that ends a drag does not open the issue; a click after it does.
  expect(fireEvent.click(card)).toBe(false);
  expect(fireEvent.click(card)).toBe(true);
});

test("a drop saves the order, pins the card and the toast's Undo writes the old order back", async () => {
  renderDrag();
  dragBy(cardOf(74), -1000);

  expect(await screen.findByText("Saving the order to GitHub")).toBeInTheDocument();
  await waitFor(() => expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: ORDER, queue: [74, 57, 58, 61, 62, 60, 72], pin: [74] }));
  expect(await screen.findByText("Saved to GitHub in Project order. #74 is pinned.")).toBeInTheDocument();
  expect(screen.getByText("#74 moves to Next 1")).toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();
  // The card stays where it was dropped, pinned, until the next read from GitHub.
  expect(cardOf(74)).toHaveAccessibleName("#74 Voice errors in the transcript strip, Next 1, slot 3, pinned");
  expect(within(taskRow(58)).getByText("Next 3")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(actions.writeOrderAction).toHaveBeenLastCalledWith({ projectId: "p1", shown: [74, 57, 58, 61, 62, 60, 72], queue: ORDER, unpin: [74] }));
  expect(await screen.findByText("Put #74 back at Next 7")).toBeInTheDocument();
  expect(cardOf(74)).toHaveAccessibleName("#74 Voice errors in the transcript strip, Next 7, slot 3");
  expect(actions.writeOrderAction).toHaveBeenCalledTimes(2);
});

test("a refused write puts the card back and offers Try again", async () => {
  actions.writeOrderAction.mockResolvedValueOnce({ ok: false, error: "GitHub API rate limit exceeded." });
  renderDrag();
  dragBy(cardOf(74), -1000);

  expect(await screen.findByText("GitHub did not take the order")).toBeInTheDocument();
  expect(screen.getByText("#74 is back at Next 7. GitHub API rate limit exceeded.")).toBeInTheDocument();
  expect(cardOf(74)).toHaveAccessibleName("#74 Voice errors in the transcript strip, Next 7, slot 3");
  expect(router.refresh).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Saved to GitHub in Project order. #74 is pinned.")).toBeInTheDocument();
  expect(actions.writeOrderAction).toHaveBeenCalledTimes(2);
  expect(actions.writeOrderAction).toHaveBeenLastCalledWith({ projectId: "p1", shown: ORDER, queue: [74, 57, 58, 61, 62, 60, 72], pin: [74] });
  expect(cardOf(74)).toHaveAccessibleName("#74 Voice errors in the transcript strip, Next 1, slot 3, pinned");
});

test("a drop before a blocker opens the dialog with Move to the next free slot picked and the checkbox on", async () => {
  renderDrag();
  dragBy(cardOf(62), -1000);

  const dialog = await screen.findByRole("dialog", { name: "#62 can't start before #61" });
  expect(dialog).toHaveTextContent("#61 Story page with its tasks blocks it.");
  expect(within(dialog).getByRole("radio", { name: "Move to the next free slot" })).toBeChecked();
  expect(within(dialog).getByRole("radio", { name: "Move #61 earlier too" })).not.toBeChecked();
  expect(within(dialog).getByRole("radio", { name: "Keep it here" })).not.toBeChecked();
  expect(dialog).toHaveTextContent("Right after #61, as Next 4.");
  expect(dialog).toHaveTextContent("#61 and #62 become Next 1 and Next 2. Nothing blocks #61.");
  expect(dialog).toHaveTextContent("Pinned at Next 1 with the warning Waits for #61. It still starts after #61 ends.");
  expect(within(dialog).getByRole("checkbox", { name: "Move the tasks that wait on #62 with it" })).toBeChecked();
  expect(dialog).toHaveTextContent("Turn it off to move only #62. The tasks after it may get warnings.");

  // Cancel writes nothing and puts the card back.
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(actions.writeOrderAction).not.toHaveBeenCalled();
  expect(cardOf(62)).toHaveAccessibleName("#62 Size chip on board cards, Next 4, slot 2");
});

/** Drops `issue` at the front, picks `choice` in the dialog, sets the checkbox and presses Move. */
async function choose(issue: number, choice: string, carry = true) {
  dragBy(cardOf(issue), -1000);
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("radio", { name: choice }));
  if (!carry) fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Move" }));
  await waitFor(() => expect(actions.writeOrderAction).toHaveBeenCalled());
}

test("each choice gives the order its operation computes", async () => {
  // The next free slot is right after #61, where #62 already was; #61 earlier too puts both first.
  for (const [choice, queue] of [
    ["Move to the next free slot", ORDER],
    ["Move #61 earlier too", [61, 62, 57, 58, 60, 72, 74]],
  ] as const) {
    const { unmount } = renderDrag();
    await choose(62, choice);
    expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: ORDER, queue, pin: [62] });
    unmount();
    vi.clearAllMocks();
    toast.dismiss();
  }

  // Keep it here pins #62 at Next 1 with the warning.
  renderDrag();
  await choose(62, "Keep it here");
  expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: ORDER, queue: [62, 57, 58, 61, 60, 72, 74], pin: [62], reason: "keep_here" });
  expect(await screen.findByText("Pinned. It waits for #61.")).toBeInTheDocument();
  expect(screen.getByText("#62 stays at Next 1")).toBeInTheDocument();
  expect(within(taskRow(62)).getByText("Waits for #61")).toBeInTheDocument();
  expect(cardOf(62)).toHaveAttribute("data-break", "true");
});

test("the checkbox carries the tasks that wait on the dropped task, and off leaves them with a warning", async () => {
  // #83 waits on #82, which waits on #81; #83 already sits before #82.
  const chain = planView([
    epic(12, "Project management", [
      story(41, "Chain", 12, [
        task(84, "Free task", "Ready", { size: "M" }),
        task(83, "Third link", "Ready", { size: "S", blockedBy: [82] }),
        task(81, "First link", "Ready", { size: "S" }),
        task(82, "Second link", "Ready", { size: "S", blockedBy: [81] }),
      ]),
    ]),
  ]);
  const props = { epics: chain.epics, flow: flowOf(chain) };
  const { unmount } = renderDrag(props);
  await choose(82, "Move to the next free slot");
  expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: [84, 83, 81, 82], queue: [84, 81, 82, 83], pin: [82] });
  unmount();
  vi.clearAllMocks();
  toast.dismiss();

  renderDrag(props);
  await choose(82, "Move to the next free slot", false);
  expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: [84, 83, 81, 82], queue: [84, 83, 81, 82], pin: [82] });
});

test("clicking the pin unpins the card", async () => {
  renderDrag({ flow: designFlow({ pins: new Set([60]) }) });
  const row60 = taskRow(60);
  expect(cardOf(60)).toHaveAccessibleName("#60 Ready count in the sidebar, Next 5, slot 3, pinned");
  // The pin on the card and the Pinned tag in the row both unpin.
  expect(within(within(row60).getByRole("rowheader")).getByRole("button", { name: "Unpin #60" })).toHaveTextContent("Pinned");
  fireEvent.click(within(within(row60).getByRole("gridcell")).getByRole("button", { name: "Unpin #60" }));

  await waitFor(() => expect(actions.unpinAction).toHaveBeenCalledWith({ projectId: "p1", issue: 60 }));
  expect(await screen.findByText("#60 is unpinned")).toBeInTheDocument();
  expect(cardOf(60)).toHaveAccessibleName("#60 Ready count in the sidebar, Next 5, slot 3");
  expect(within(row60).queryByRole("button", { name: "Unpin #60" })).not.toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();
  expect(actions.writeOrderAction).not.toHaveBeenCalled();
});

test("Alt and an arrow move a task one place with one save after the last key", async () => {
  renderDrag();
  const card = cardOf(74);
  expect(card).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight Escape");
  act(() => card.focus());

  // An arrow without Alt moves nothing.
  fireEvent.keyDown(card, { key: "ArrowLeft" });
  expect(dragTip()).not.toBeInTheDocument();
  fireEvent.keyDown(card, { key: "ArrowLeft", altKey: true });
  fireEvent.keyDown(card, { key: "ArrowLeft", altKey: true });
  expect(dragTip()).toHaveTextContent("Next 5, before #60");
  expect(dragTip()).toHaveTextContent("Saves when you stop pressing keys.");

  await act(() => vi.advanceTimersByTimeAsync(KEY_DELAY - 1));
  expect(actions.writeOrderAction).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: ORDER, queue: [57, 58, 61, 62, 74, 60, 72], pin: [74] });
  expect(await screen.findByText("#74 moves to Next 5")).toBeInTheDocument();
  expect(actions.writeOrderAction).toHaveBeenCalledTimes(1);
});

test("running, done, skipped and Shaping cards do not drag", () => {
  const mixed = planView([
    epic(12, "Project management", [
      story(41, "Mixed", 12, [
        task(55, "Shaping tools", "Running", { size: "L" }),
        task(58, "Plan page tree and board", "Ready", { size: "M" }),
        task(63, "Release notes", "Ready", { size: "S", labels: ["task", "human"] }),
        task(64, "Board filters", "Shaping", { size: "S" }),
        task(69, "Transcript strip", "Done", { state: "closed" }),
      ]),
    ]),
  ]);
  renderDrag({ epics: mixed.epics, flow: flowOf(mixed, { lanes: 2, runs: [flowRun(55, 0, 3, 7)] }) });
  for (const n of [55, 64]) {
    const card = cardOf(n);
    const left = leftOf(card);
    expect(card).not.toHaveAttribute("aria-keyshortcuts");
    fireEvent.pointerDown(card, { pointerId: 1, button: 0, clientX: 500 });
    fireEvent.pointerMove(card, { pointerId: 1, clientX: 900 });
    expect(dragTip()).not.toBeInTheDocument();
    expect(leftOf(card)).toBe(left);
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 900 });
    fireEvent.keyDown(card, { key: "ArrowRight", altKey: true });
    expect(dragTip()).not.toBeInTheDocument();
  }
  // Done and skipped tasks have no card to drag; a Ready task drags.
  for (const n of [63, 69]) expect(within(taskRow(n)).queryByRole("link", { name: /, Next / })).not.toBeInTheDocument();
  expect(cardOf(58)).toHaveAttribute("aria-keyshortcuts");
  expect(actions.writeOrderAction).not.toHaveBeenCalled();
});

test("under Priority order a drop asks to switch to Project order", async () => {
  renderDrag({ flow: designFlow({ order: "priority", priorityOptions: ["P0", "P1"] }) });
  dragBy(cardOf(74), -1000);

  let dialog = await screen.findByRole("dialog", { name: "The scheduler starts tasks by Priority" });
  expect(dialog).toHaveTextContent("Switch it to Project order to plan by dragging?");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(schedulerActions.switchToProjectOrderAction).not.toHaveBeenCalled();
  expect(actions.writeOrderAction).not.toHaveBeenCalled();
  expect(cardOf(74)).toHaveAccessibleName("#74 Voice errors in the transcript strip, Next 7, slot 3");

  // Switching saves the scheduler's order, then the drop.
  dragBy(cardOf(74), -1000);
  dialog = await screen.findByRole("dialog", { name: "The scheduler starts tasks by Priority" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Switch to Project order" }));
  await waitFor(() => expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: ORDER, queue: [74, 57, 58, 61, 62, 60, 72], pin: [74] }));
  expect(schedulerActions.switchToProjectOrderAction).toHaveBeenCalledWith({ projectId: "p1" });
  expect(await screen.findByText("Saved to GitHub in Project order. #74 is pinned.")).toBeInTheDocument();
  expect(screen.getByText("Project order. Length by size.")).toBeInTheDocument();
});

/** The Plan page's Flow with its toolbar controls, which share the ticks in the tree and the Optimize preview. */
function Optimizing(props: Props) {
  const selection = useFlowSelectionState();
  return (
    <FlowSelection value={selection}>
      <FlowControls projectId="p1" />
      <PlanFlow {...props} />
    </FlowSelection>
  );
}

function renderOptimize(over: Partial<Props> = {}) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const props: Props = {
    projectId: "p1",
    repoUrl: REPO_URL,
    epics: view.epics,
    unparented: [],
    flow: designFlow({ pins: new Set([60]) }),
    scheduler: { state: "running", claudeSlots: 3 },
    graphs: ["loop"],
    graphName: "loop",
    ...over,
  };
  return render(
    <TooltipProvider>
      <Optimizing {...props} />
      <Toaster />
    </TooltipProvider>,
  );
}

const tick = (n: number) => screen.getByRole("checkbox", { name: `Select #${n}` });

test("ticking an epic ticks its stories and tasks and the toolbar says 1 selected", () => {
  renderOptimize();
  expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();

  fireEvent.click(tick(12));
  for (const n of [12, 41, 43, 55, 57, 58, 61, 62, 60]) expect(tick(n)).toBeChecked();
  for (const n of [10, 18, 72, 74]) expect(tick(n)).not.toBeChecked();
  expect(screen.getByText("1 selected")).toBeInTheDocument();

  // Unticking a story under the ticked epic leaves its other story ticked, and the epic half ticked.
  fireEvent.click(tick(43));
  expect(tick(43)).not.toBeChecked();
  expect(tick(61)).not.toBeChecked();
  expect(tick(41)).toBeChecked();
  expect(tick(57)).toBeChecked();
  expect(tick(12)).toHaveAttribute("aria-checked", "mixed");
  expect(screen.getByText("1 selected")).toBeInTheDocument();

  // A task in the other epic adds to the selection.
  fireEvent.click(tick(74));
  expect(screen.getByText("2 selected")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear the selection" }));
  expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  for (const n of [12, 41, 57, 74]) expect(tick(n)).not.toBeChecked();
});

const preview = () => screen.queryByRole("status", { name: "Optimize preview" });

test("Optimize previews the moves with their old places and writes nothing until Apply", () => {
  renderOptimize();
  fireEvent.click(tick(12));
  fireEvent.click(screen.getByRole("button", { name: "Optimize" }));

  // #61 sits on the longest chain, so it goes first; #62 follows its blocker and #57 goes after them.
  const banner = preview()!;
  expect(banner).toHaveTextContent("Optimize will move 3 tasks in epic #12 Project management. 1 pinned stays.");
  expect(banner).toHaveTextContent("Everything outside the selection keeps its place.");
  expect(screen.getByRole("button", { name: "Optimize" })).toHaveAttribute("aria-pressed", "true");
  for (const [n, next, was] of [
    [61, 1, 3],
    [62, 3, 4],
    [57, 4, 1],
  ] as const) {
    const row = taskRow(n);
    expect(within(row).getByText(`Next ${next}`)).toBeInTheDocument();
    expect(within(row).getByText(`was ${was}`)).toBeInTheDocument();
    expect(cardOf(n)).toHaveAccessibleName(new RegExp(`, Next ${next}, slot \\d, moved by Optimize from Next ${was}$`));
    expect(cardOf(n)).toHaveAttribute("data-preview", "true");
    // The card's old place is outlined.
    expect(row.querySelector("[data-ghost]")).not.toBeNull();
  }
  // #58 keeps its place.
  expect(within(taskRow(58)).getByText("Next 2")).toBeInTheDocument();
  expect(within(taskRow(58)).queryByText(/^was /)).not.toBeInTheDocument();
  expect(actions.writeOrderAction).not.toHaveBeenCalled();

  // Cancel puts every card back and writes nothing.
  fireEvent.click(within(banner).getByRole("button", { name: "Cancel" }));
  expect(preview()).not.toBeInTheDocument();
  expect(within(taskRow(61)).getByText("Next 3")).toBeInTheDocument();
  expect(within(taskRow(61)).queryByText(/^was /)).not.toBeInTheDocument();
  expect(cardOf(61)).not.toHaveAttribute("data-preview");
  expect(actions.writeOrderAction).not.toHaveBeenCalled();
});

test("Apply writes the order and the toast's Undo restores it", async () => {
  renderOptimize();
  fireEvent.click(tick(12));
  fireEvent.click(screen.getByRole("button", { name: "Optimize" }));
  fireEvent.click(within(preview()!).getByRole("button", { name: "Apply" }));

  // Optimize never pins: the write names no pin, and #60 keeps the pin it had.
  const optimized = [61, 58, 62, 57, 60, 72, 74];
  await waitFor(() => expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: ORDER, queue: optimized }));
  expect(preview()).not.toBeInTheDocument();
  expect(await screen.findByText("Optimized epic #12 Project management")).toBeInTheDocument();
  expect(screen.getByText("Moved 3 tasks. 1 pinned stayed.")).toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();
  // The cards show the new order until the next read from GitHub, with no preview marks.
  expect(cardOf(61)).toHaveAccessibleName("#61 Story page with its tasks, Next 1, slot 3");
  expect(cardOf(60)).toHaveAccessibleName(/, Next 5, slot \d, pinned$/);
  expect(within(taskRow(61)).queryByText(/^was /)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(actions.writeOrderAction).toHaveBeenLastCalledWith({ projectId: "p1", shown: optimized, queue: ORDER }));
  expect(await screen.findByText("Put the order back")).toBeInTheDocument();
  expect(within(taskRow(61)).getByText("Next 3")).toBeInTheDocument();
  expect(actions.writeOrderAction).toHaveBeenCalledTimes(2);
});

test("pinned cards and tasks outside the selection keep their places", async () => {
  renderOptimize();
  // The whole plan: #60 is pinned at Next 5 and stays there.
  fireEvent.click(screen.getByRole("button", { name: "Optimize" }));
  expect(preview()).toHaveTextContent("Optimize will move 3 tasks in the plan. 1 pinned stays.");
  expect(preview()).toHaveTextContent("Pinned tasks keep their places.");
  expect(within(taskRow(60)).getByText("Next 5")).toBeInTheDocument();
  expect(within(taskRow(60)).queryByText(/^was /)).not.toBeInTheDocument();
  expect(cardOf(60)).not.toHaveAttribute("data-preview");

  // Story #41 alone: #58 and #57 trade places, and #61, which the whole plan put first, keeps Next 3.
  fireEvent.click(tick(41));
  expect(preview()).toHaveTextContent("Optimize will move 2 tasks in story #41 Shaping with the assistant.");
  expect(preview()).not.toHaveTextContent("pinned");
  expect(within(taskRow(58)).getByText("was 2")).toBeInTheDocument();
  expect(within(taskRow(57)).getByText("was 1")).toBeInTheDocument();
  for (const [n, next] of [
    [61, 3],
    [62, 4],
    [60, 5],
    [72, 6],
    [74, 7],
  ] as const) {
    expect(within(taskRow(n)).getByText(`Next ${next}`)).toBeInTheDocument();
    expect(within(taskRow(n)).queryByText(/^was /)).not.toBeInTheDocument();
  }

  fireEvent.click(within(preview()!).getByRole("button", { name: "Apply" }));
  await waitFor(() => expect(actions.writeOrderAction).toHaveBeenCalledWith({ projectId: "p1", shown: ORDER, queue: [58, 57, 61, 62, 60, 72, 74] }));
  expect(await screen.findByText("Optimized story #41 Shaping with the assistant")).toBeInTheDocument();
  expect(screen.getByText("Moved 2 tasks.")).toBeInTheDocument();
});

test("under Priority order Optimize asks to switch to Project order before its preview", async () => {
  renderOptimize({ flow: designFlow({ pins: new Set([60]), order: "priority", priorityOptions: ["P0", "P1"] }) });
  fireEvent.click(screen.getByRole("button", { name: "Optimize" }));
  let dialog = await screen.findByRole("dialog", { name: "The scheduler starts tasks by Priority" });
  expect(dialog).toHaveTextContent("Switch it to Project order to optimize the order?");
  expect(preview()).not.toBeInTheDocument();

  // Cancel leaves the order and shows no preview.
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Optimize" })).toHaveAttribute("aria-pressed", "false");
  expect(schedulerActions.switchToProjectOrderAction).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Optimize" }));
  dialog = await screen.findByRole("dialog", { name: "The scheduler starts tasks by Priority" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Switch to Project order" }));
  await waitFor(() => expect(schedulerActions.switchToProjectOrderAction).toHaveBeenCalledWith({ projectId: "p1" }));
  expect(await screen.findByRole("status", { name: "Optimize preview" })).toHaveTextContent("Optimize will move 3 tasks in the plan. 1 pinned stays.");
  expect(actions.writeOrderAction).not.toHaveBeenCalled();
});

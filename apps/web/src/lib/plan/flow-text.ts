import type { PlanSize } from "@handoff/github";
import type { SchedulerState } from "@/server/scheduler";
import type { Flow } from "./flow";

/** What the Flow tells of the scheduler: whether it is on, and the Claude slots of the newest live worker. */
export type SchedulerBrief = {
  state: SchedulerState;
  claudeSlots: number | null;
};

/** A task without a size counts as M (docs/plans/flow.md, Decision 6). */
export const DEFAULT_SIZE: PlanSize = "M";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "3 runs at once, 1 Claude slot": the lanes and, with a scheduler, the Claude slots beside them. */
export function runsText(lanes: number, scheduler: SchedulerBrief | undefined): string {
  const runs = `${plural(lanes, "run")} at once`;
  if (!scheduler) return runs;
  return `${runs}, ${scheduler.claudeSlots === null ? "no worker running" : plural(scheduler.claudeSlots, "Claude slot")}`;
}

/** What the header says of the scheduler beside Now: why it is held, or that it starts nothing by itself. */
export function schedulerNote(flow: Pick<Flow, "held">, scheduler: SchedulerBrief | undefined): { tone: "attention" | "outline"; text: string } | undefined {
  if (flow.held.length > 0) return { tone: "attention", text: `Held: ${flow.held.join("; ")}` };
  if (scheduler?.state === "off" || scheduler?.state === "paused") {
    return {
      tone: "outline",
      text: `The scheduler is ${scheduler.state}: tasks start when someone starts them, in this order`,
    };
  }
  return undefined;
}

/** A sentence with a lower-case first letter, to end a card's name: "waits on you: review". */
export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** "1 task" or "3 tasks". */
export const tasksText = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;

/** "1 pinned stays." or "2 pinned stay.", after Apply "stayed."; nothing without pins in the scope. */
const keptText = (kept: number, past = false) => (kept === 0 ? "" : ` ${kept} pinned ${past ? "stayed" : kept === 1 ? "stays" : "stay"}.`);

/** What Optimize's preview says it will do: "Optimize will move 3 tasks in epic #12 Project management. 1 pinned stays." */
export function previewSentence(moved: number, kept: number, scope: string): string {
  const head = moved === 0 ? `Optimize finds nothing to move in ${scope}.` : `Optimize will move ${tasksText(moved)} in ${scope}.`;
  return `${head}${keptText(kept)}`;
}

/** What the toast says after Optimize's Apply: "Moved 3 tasks. 1 pinned stayed." */
export const appliedSentence = (moved: number, kept: number) => `Moved ${tasksText(moved)}.${keptText(kept, true)}`;

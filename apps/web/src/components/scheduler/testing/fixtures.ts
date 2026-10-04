import type { SchedulerFormContext } from "@/lib/scheduler-form";
import type { SchedulerCard } from "@/server/scheduler-card";
import type { SchedulerStatus } from "@/server/scheduler";

export const PROJECT = { id: "6c588fd7-a382-4b79-b10b-695212d490e2", name: "todooverkill" };
export const NOW = new Date("2026-10-02T18:31:12Z");
export const RUN = "3b9e21c4-1111-4000-8000-000000000000";
export const OTHER = "64fde8ef-2222-4000-8000-000000000000";

const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

/** The form's context on the Plan page of todooverkill: graph master, GitHub Project #5 without a Priority field. */
export const FORM: SchedulerFormContext = { graphs: ["master", "fast"], defaultGraph: "master", planNumber: 5, priority: undefined };

/** A scheduler card read, on and running with nothing active, unless `status` and the rest say otherwise. */
export function cardOf(over: Partial<Omit<SchedulerCard, "status">> & { status?: Partial<SchedulerStatus> } = {}): SchedulerCard {
  const { status, ...rest } = over;
  return {
    status: {
      state: "running",
      settings: { maxRuns: 2, order: "project", graphName: "master", skipLabel: "human" },
      paused: undefined,
      summary: "0 of 2 runs active, 1 Claude slot",
      active: 0,
      claudeSlots: 1,
      activeRuns: [],
      holds: [],
      overlapHeld: [],
      idle: undefined,
      error: undefined,
      next: [],
      skipped: [],
      checkedAt: ago(12),
      nextCheckAt: ago(-48),
      events: [],
      ...status,
    },
    runs: [],
    holdIssues: {},
    events: [],
    pausedFrom: null,
    next: [],
    skipped: [],
    ...rest,
  };
}

export const OFF = cardOf({ status: { state: "off", settings: undefined, summary: "0 runs active, 1 Claude slot", checkedAt: null, nextCheckAt: null } });
export { ago };

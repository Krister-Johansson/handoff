import { expect, test } from "vitest";
import { checkText, describeSchedulerEvent } from "./scheduler-text";

const RUN = "3b9e21c4-0000-0000-0000-000000000000";
const OTHER = "64fde8ef-0000-0000-0000-000000000000";
const settings = (maxRuns: number, order = "project", graphName = "master", skipLabel: string | null = "human") => ({ maxRuns, order, graphName, skipLabel });

test("each scheduler event reads as one sentence", () => {
  const cases: [string, Record<string, unknown>, string][] = [
    ["scheduler.started", { by: "assistant", settings: settings(1) }, "Turned on from the assistant: up to 1 run, Project order, graph master"],
    ["scheduler.started", { by: "claude-code", settings: settings(3, "priority", "fast") }, "Turned on from Claude Code: up to 3 runs, Priority order, graph fast"],
    ["scheduler.resumed", { by: "dashboard" }, "Resumed from the dashboard"],
    ["scheduler.changed", { by: "dashboard", from: settings(1), to: settings(2) }, "Changed from the dashboard: up to 1 run, now up to 2"],
    [
      "scheduler.changed",
      { by: "cli", from: settings(1), to: settings(1, "priority", "fast", null) },
      "Changed from the CLI: Project order, now Priority order; graph master, now fast; skips tasks labelled human, now none",
    ],
    ["scheduler.paused", { by: "dashboard", reason: "Stop for the night" }, 'Paused by a person from the dashboard: "Stop for the night"'],
    ["scheduler.paused", { by: "dashboard" }, "Paused by a person from the dashboard"],
    ["scheduler.paused", { by: "scheduler", reason: "3 starts failed in a row. The last error: GitHub refused." }, "Paused itself: 3 starts failed in a row"],
    ["scheduler.stopped", { by: "dashboard" }, "Turned off from the dashboard"],
    ["scheduler.held", { holds: [{ kind: "review", runId: RUN, nodeKey: "human_gate-1", questionId: "q" }] }, "Held: run 3b9e21c4 waits for your review at human_gate-1"],
    [
      "scheduler.held",
      { holds: [{ kind: "failed", runId: RUN, nodeKey: "coder-1" }, { kind: "permission", runId: OTHER, nodeKey: "coder-1", permissionId: "p", toolName: "Bash" }] },
      "Held: run 3b9e21c4 failed at coder-1, and 1 more",
    ],
    ["scheduler.idle", { reason: "no_ready" }, "Idle: no task is Ready"],
    ["scheduler.idle", { reason: "planning", runId: RUN }, "Idle: run 3b9e21c4 is still planning; the next start waits for its plan"],
    ["scheduler.idle", { reason: "all_skipped" }, "Idle: every Ready task is skipped"],
    ["scheduler.run_started", { runId: RUN, issue: 141, place: 1 }, "Started run 3b9e21c4 on #141, 1st in order"],
    ["scheduler.run_started", { runId: RUN, issue: 67, place: 2 }, "Started run 3b9e21c4 on #67, 2nd in order"],
    ["scheduler.skipped", { issue: 142, reason: "blocked by #141" }, "Skipped #142: blocked by #141"],
    ["scheduler.start_failed", { error: "GitHub Project #5 of octo does not exist." }, "Start failed: GitHub Project #5 of octo does not exist."],
    ["scheduler.released", { issue: 66, runId: RUN, by: "dashboard" }, "Let the scheduler take #66 again from the dashboard"],
  ];
  for (const [type, payload, sentence] of cases) expect(describeSchedulerEvent({ type, payload }), type).toBe(sentence);
});

test("the check line says when the scheduler last checked, or when its first check comes", () => {
  const now = new Date("2026-10-02T18:00:00Z");
  const at = (seconds: number) => new Date(now.getTime() + seconds * 1000);

  expect(checkText({ checkedAt: at(-12), nextCheckAt: at(48) }, now)).toBe("Checked 12 s ago");
  expect(checkText({ checkedAt: at(-125), nextCheckAt: at(-5) }, now)).toBe("Checked 2 min ago");
  expect(checkText({ checkedAt: null, nextCheckAt: at(9.4) }, now)).toBe("Not checked yet; first check in about 10 s");
  expect(checkText({ checkedAt: null, nextCheckAt: at(-3) }, now)).toBe("Not checked yet; first check due now");
  expect(checkText({ checkedAt: null, nextCheckAt: null }, now)).toBe("Not checked yet");
});

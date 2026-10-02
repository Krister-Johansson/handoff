import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SchedulerCard } from "./scheduler-card";
import { ago, cardOf, FORM, NOW, OFF, OTHER, PROJECT, RUN } from "./testing/fixtures";

const actions = vi.hoisted(() => ({
  turnOnSchedulerAction: vi.fn(async () => ({ ok: true as const })),
  pauseSchedulerAction: vi.fn(async () => ({ ok: true as const })),
  resumeSchedulerAction: vi.fn(async () => ({ ok: true as const })),
  releaseTaskAction: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("@/app/projects/scheduler-actions", () => actions);
vi.mock("@/app/projects/actions", () => ({ startRunAction: vi.fn(), listIssuesAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => localStorage.clear());
afterEach(() => vi.clearAllMocks());

const wrapper = ({ children }: { children: ReactNode }) => <TooltipProvider>{children}</TooltipProvider>;
const show = (card = cardOf(), more: Partial<Parameters<typeof SchedulerCard>[0]> = {}) =>
  render(<SchedulerCard project={PROJECT} card={card} form={FORM} now={NOW} {...more} />, { wrapper });

test("Off offers Turn on behind a popover form with the settings sentence", async () => {
  show(OFF);
  expect(screen.getByText("Off")).toBeInTheDocument();
  expect(screen.getByText("Starts runs on Ready tasks on its own, up to a limit you set.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Turn on the scheduler of todooverkill" }));
  const form = await screen.findByRole("dialog", { name: "Turn on the scheduler" });
  expect(within(form).getByRole("spinbutton", { name: "Runs at a time" })).toHaveValue(1);
  expect(within(form).getByRole("radio", { name: "Project order" })).toBeChecked();
  expect(within(form).getByRole("radio", { name: "Priority" })).toBeDisabled();
  expect(within(form).getByText("GitHub Project #5 has no Priority field.")).toBeInTheDocument();
  expect(within(form).getByRole("combobox", { name: "Graph" })).toHaveValue("master");

  fireEvent.click(within(form).getByRole("button", { name: "One more" }));
  fireEvent.change(within(form).getByRole("combobox", { name: "Graph" }), { target: { value: "fast" } });
  expect(within(form).getByText(/Let handoff start up to 2 runs at a time on Ready tasks in todooverkill, in Project order, with graph fast\./)).toBeInTheDocument();

  fireEvent.click(within(form).getByRole("button", { name: "Turn on" }));
  await waitFor(() => expect(actions.turnOnSchedulerAction).toHaveBeenCalledWith({ projectId: PROJECT.id, maxRuns: 2, order: "project", graph: "fast" }));
});

const running = cardOf({
  status: { summary: "2 of 2 runs active, 1 Claude slot", active: 2 },
  runs: [
    { id: RUN, href: `/projects/${PROJECT.id}/runs/${RUN}`, startedBy: "scheduler", issue: { number: 141, title: "R1 Redesign tokens" }, node: "coder-1", now: { tone: "active", text: "coder-1 is working" } },
    {
      id: OTHER,
      href: `/projects/${PROJECT.id}/runs/${OTHER}`,
      startedBy: "dashboard",
      issue: { number: 16, title: "F16 Drag and drop on the board" },
      node: "human_gate-1",
      now: { tone: "attention", text: "human_gate-1 waits for your review" },
      reviewHref: `/projects/${PROJECT.id}/runs/${OTHER}/review/q1`,
    },
  ],
  next: [
    { number: 66, title: "F52 Tasks service follow-ups" },
    { number: 67, title: "F53 Shared localStorage store helper" },
  ],
  events: [{ id: 3, type: "scheduler.run_started", text: "Started run 3b9e21c4 on #141, 1st in order", at: ago(26 * 60) }],
});

test("held lists each failed run and permission prompt with a link to its run, and what starts once they clear", () => {
  const runHref = (id: string) => `/projects/${PROJECT.id}/runs/${id}`;
  show(
    cardOf({
      status: {
        state: "held",
        summary: "1 of 3 runs active, 1 Claude slot",
        holds: [
          { kind: "failed", runId: OTHER, nodeKey: "coder-1", text: "Run 64fde8ef failed at coder-1", href: runHref(OTHER) },
          { kind: "permission", runId: RUN, nodeKey: "coder-1", permissionId: "p1", toolName: "Bash", text: "Run 3b9e21c4 asks permission to use Bash at coder-1", href: runHref(RUN) },
        ],
      },
      holdIssues: { [OTHER]: { number: 66, title: "F52 Tasks service follow-ups" }, [RUN]: { number: 141, title: "R1 Redesign tokens" } },
      next: [{ number: 67, title: "F53 Shared localStorage store helper" }],
    }),
  );
  expect(screen.getByText("Held")).toBeInTheDocument();

  const holds = within(screen.getByRole("list", { name: "Holding new starts" })).getAllByRole("listitem");
  expect(holds).toHaveLength(2);
  expect(holds[0]).toHaveTextContent("#66Run 64fde8ef failed at coder-1");
  expect(within(holds[0]!).getByRole("link", { name: "Open run" })).toHaveAttribute("href", runHref(OTHER));
  expect(holds[1]).toHaveTextContent("#141Run 3b9e21c4 asks permission to use Bash at coder-1");
  expect(within(holds[1]!).getByRole("link", { name: "Open run" })).toHaveAttribute("href", runHref(RUN));

  expect(screen.getByText("Within 10 seconds of the last one clearing, it starts these in order, one at a time:")).toBeInTheDocument();
  expect(within(screen.getByRole("list", { name: "Next up" })).getByText(/F53 Shared localStorage store helper/)).toBeInTheDocument();
  expect(screen.getByText("Holds count every run of todooverkill, also runs a person started. Active runs go on.")).toBeInTheDocument();
});

test("idle says why and Next up lists the candidates with a Skipped disclosure", async () => {
  const skipped = [
    { number: 46, title: "F46 Screen reader pass (human task)", reason: "labelled human" },
    { number: 66, title: "F52 Tasks service follow-ups", reason: "cancelled run; start it by hand", releasable: true as const },
    { number: 142, title: "R2 Geist type", reason: "blocked by #141" },
  ];
  const { unmount } = show(cardOf({ status: { state: "idle", idle: { reason: "no_ready", text: "No task is Ready. Move shaped tasks to Ready on the Plan." } } }));
  expect(screen.getByText("Idle")).toBeInTheDocument();
  expect(screen.getByText("No task is Ready. Move shaped tasks to Ready on the Plan.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Show Shaping tasks" })).toHaveAttribute("href", `/projects/${PROJECT.id}/plan?status=Shaping`);
  expect(screen.getByText("Moving a task to Ready is a person's decision; the scheduler only starts Ready tasks.")).toBeInTheDocument();
  unmount();

  // Every Ready task skipped: the list is open, each with its reason, and a cancelled one can go back to the scheduler.
  const all = show(cardOf({ status: { state: "idle", idle: { reason: "all_skipped", text: "Every Ready task is skipped; skipped says why." } }, skipped }), { start: { graphs: ["master"], graphName: "master" } });
  expect(screen.getByText("Every Ready task is skipped, each for the reason below.")).toBeInTheDocument();
  const rows = within(screen.getByRole("list", { name: "Skipped" })).getAllByRole("listitem");
  expect(rows.map((r) => r.textContent)).toEqual([
    expect.stringContaining("labelled human"),
    expect.stringContaining("cancelled run; start it by hand"),
    expect.stringContaining("blocked by #141"),
  ]);
  expect(within(rows[0]!).queryByRole("button", { name: "Let the scheduler take it" })).not.toBeInTheDocument();
  expect(within(rows[1]!).getByRole("button", { name: "Start run" })).toBeInTheDocument();
  fireEvent.click(within(rows[1]!).getByRole("button", { name: "Let the scheduler take it" }));
  await waitFor(() => expect(actions.releaseTaskAction).toHaveBeenCalledWith({ projectId: PROJECT.id, issue: 66 }));
  all.unmount();

  // Running with candidates: the skipped tasks wait behind a disclosure under Next up.
  show(cardOf({ next: [{ number: 67, title: "F53 Shared localStorage store helper" }], skipped: skipped.slice(2) }));
  expect(screen.queryByRole("list", { name: "Skipped" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "1 skipped" }));
  expect(within(screen.getByRole("list", { name: "Skipped" })).getByText("blocked by #141")).toBeInTheDocument();
});

test("running shows active runs of max_runs and the Claude slots, with Pause", async () => {
  show(running);
  expect(screen.getByText("Running")).toBeInTheDocument();
  expect(screen.getByText("2 of 2 runs active, 1 Claude slot")).toBeInTheDocument();
  expect(screen.getByText("Checked 12 s ago")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Up to 2 runs, Project order, master" })).toHaveAttribute("href", `/projects/${PROJECT.id}/settings`);

  const active = screen.getByRole("list", { name: "Active runs" });
  const [mine, theirs] = within(active).getAllByRole("listitem");
  expect(within(mine!).getByRole("link", { name: /#141 R1 Redesign tokens/ })).toHaveAttribute("href", `/projects/${PROJECT.id}/runs/${RUN}`);
  expect(within(mine!).getByText("Scheduler")).toBeInTheDocument();
  expect(within(mine!).getByText("coder-1")).toBeInTheDocument();
  // A run waiting on a review stays active and says what it waits for, with the way to it.
  expect(within(theirs!).queryByText("Scheduler")).not.toBeInTheDocument();
  expect(within(theirs!).getByText("human_gate-1 waits for your review")).toBeInTheDocument();
  expect(within(theirs!).getByRole("link", { name: "Open the review" })).toHaveAttribute("href", `/projects/${PROJECT.id}/runs/${OTHER}/review/q1`);

  const next = screen.getByRole("list", { name: "Next up" });
  expect(within(next).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1#66 F52 Tasks service follow-ups", "2#67 F53 Shared localStorage store helper"]);
  expect(within(screen.getByRole("list", { name: "Recent" })).getByText("Started run 3b9e21c4 on #141, 1st in order")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Pause the scheduler of todooverkill" }));
  const pause = await screen.findByRole("dialog", { name: "Pause the scheduler" });
  fireEvent.change(within(pause).getByLabelText("Reason (optional)"), { target: { value: "Waiting for the redesign review" } });
  fireEvent.click(within(pause).getByRole("button", { name: "Pause" }));
  await waitFor(() => expect(actions.pauseSchedulerAction).toHaveBeenCalledWith({ projectId: PROJECT.id, reason: "Waiting for the redesign review" }));
});

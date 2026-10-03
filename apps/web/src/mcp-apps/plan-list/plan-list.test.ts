import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { deferred, errorResult, mountView, textResult, unmountViews } from "../testing";
import { startPlanList } from "./main";

const BASE = "http://localhost:3000";
const RUN = "7f3a2c1e-0000-4000-8000-000000000001";
const issue = (n: number) => `https://github.com/octo/sample/issues/${n}`;

const task = (number: number, title: string, status: string, extra: Record<string, unknown> = {}) => ({
  number,
  kind: "task",
  title,
  status,
  state: status === "Done" ? "closed" : "open",
  url: issue(number),
  blocked_by: [],
  run: null,
  pr: null,
  size: null,
  proposal: null,
  ...extra,
});

/** list_plan's answer for a Timeline project: dates on every item. */
const timeline = {
  mode: "timeline",
  project: { number: 3, title: "Sample roadmap", url: "https://github.com/users/octo/projects/3" },
  capacity_hours: 6,
  forecasts: null,
  epics: [
    {
      number: 1,
      kind: "epic",
      title: "Shaping tools",
      status: "Running",
      state: "open",
      url: issue(1),
      start: "2026-10-01",
      target: "2026-10-09",
      progress: "1 of 3 done",
      stories: [
        {
          number: 2,
          kind: "story",
          title: "Plan from chat",
          status: "Running",
          state: "open",
          url: issue(2),
          start: null,
          target: null,
          progress: "1 of 3 done",
          tasks: [
            task(10, "Add the migration", "Done", { pr: 40, size: "S", start: "2026-10-01", target: "2026-10-02", run: { id: RUN, status: "succeeded", url: `${BASE}/projects/p1/runs/${RUN}` } }),
            task(11, "Write the tool", "Ready", { size: "M", start: "2026-10-03", target: "2026-10-06" }),
            task(12, "Document it", "Shaping", { blocked_by: [11], start: null, target: null }),
          ],
        },
      ],
      tasks: [],
    },
  ],
  unparented: [],
  unplanned: [{ number: 30, title: "Fix the footer", url: issue(30) }],
};

/** list_plan's answer for a Flow project: an order with lanes and pins and no dates. */
const flow = {
  mode: "flow",
  project: { number: 3, title: "Sample roadmap", url: "https://github.com/users/octo/projects/3" },
  lanes: 2,
  order: "project",
  held: ["the scheduler is paused"],
  queue: [21, 22],
  epics: [
    {
      number: 1,
      kind: "epic",
      title: "Order of work",
      status: "Running",
      state: "open",
      url: issue(1),
      progress: "0 of 3 done",
      stories: [],
      tasks: [
        task(20, "Running task", "Running", { place: null, lane: 1, pinned: false, waits_for: [], after: null, skipped: null, progress: { done: 2, total: 5 }, waits_on: null, run: { id: RUN, status: "running", url: `${BASE}/projects/p1/runs/${RUN}` } }),
        task(21, "First in line", "Ready", { place: 1, lane: 2, pinned: true, waits_for: [], after: null, skipped: null, progress: null, waits_on: null }),
        task(22, "Second in line", "Shaping", { place: 2, lane: 1, pinned: false, waits_for: [7], after: 20, skipped: "label human", progress: null, waits_on: null }),
      ],
    },
  ],
  unparented: [],
  unplanned: [],
};

afterEach(unmountViews);

const row = (name: RegExp | string) => within(screen.getByRole("listitem", { name }));

test("a Timeline plan shows epics, stories and tasks with status, progress, blockers, run, pull request, size and dates", async () => {
  await mountView(startPlanList, { input: { project: "sandbox" }, result: textResult(timeline) });
  const plan = within(await screen.findByRole("region", { name: "Plan" }));
  expect(plan.getByText("Sample roadmap")).toBeInTheDocument();
  expect(plan.getByText("Timeline")).toBeInTheDocument();
  const epic = row("Epic #1 Shaping tools");
  expect(epic.getAllByText("1 of 3 done")).toHaveLength(2);
  expect(epic.getByText("Oct 1 to Oct 9")).toBeInTheDocument();
  const done = row("Task #10 Add the migration, Done");
  expect(done.getByText("Done")).toBeInTheDocument();
  expect(done.getByText("S")).toBeInTheDocument();
  expect(done.getByRole("link", { name: "succeeded" })).toHaveAttribute("href", `${BASE}/projects/p1/runs/${RUN}`);
  expect(done.getByRole("link", { name: "PR #40" })).toHaveAttribute("href", "https://github.com/octo/sample/pull/40");
  expect(done.getByText("Oct 1 to Oct 2")).toBeInTheDocument();
  expect(row("Task #11 Write the tool, Ready").getByText("M")).toBeInTheDocument();
  const shaping = row("Task #12 Document it, Shaping");
  expect(shaping.getByText("Blocked by #11")).toBeInTheDocument();
  expect(shaping.getByText("No size")).toBeInTheDocument();
  expect(plan.getByRole("listitem", { name: "Issue #30 Fix the footer" })).toBeInTheDocument();
  expect(plan.getByRole("link", { name: "Open in Plan" })).toHaveAttribute("href", `${BASE}/projects/p1/plan`);
});

test("a Flow plan shows the order, lanes and pins and no dates", async () => {
  await mountView(startPlanList, { input: { project: "sandbox" }, result: textResult({ ...flow, epics: flow.epics.map((e) => ({ ...e, start: "2026-10-01", target: "2026-10-09" })) }) });
  const plan = within(await screen.findByRole("region", { name: "Plan" }));
  expect(plan.getByText("Flow")).toBeInTheDocument();
  expect(plan.getByText("2 runs at once · Project order")).toBeInTheDocument();
  expect(plan.getByText("Held: the scheduler is paused")).toBeInTheDocument();
  expect(plan.queryByText(/Oct/)).not.toBeInTheDocument();
  const running = row("Task #20 Running task, Running");
  expect(running.getByText("Slot 1")).toBeInTheDocument();
  expect(running.getByText("2 of 5 steps")).toBeInTheDocument();
  const first = row("Task #21 First in line, Ready");
  expect(first.getByText("Next 1")).toBeInTheDocument();
  expect(first.getByText("Slot 2")).toBeInTheDocument();
  expect(first.getByText("Pinned")).toBeInTheDocument();
  const second = row("Task #22 Second in line, Shaping");
  expect(second.getByText("Next 2")).toBeInTheDocument();
  expect(second.getByText("After #20")).toBeInTheDocument();
  expect(second.getByText("Waits for #7")).toBeInTheDocument();
  expect(second.getByText("Skipped: label human")).toBeInTheDocument();
});

test("Move to Ready asks move_to_ready, shows it pending, then shows the task in Ready", async () => {
  const moved = deferred<ReturnType<typeof textResult>>();
  const { calls } = await mountView(startPlanList, { input: { project: "sandbox" }, result: textResult(timeline), tools: { move_to_ready: () => moved.promise } });
  await screen.findByRole("region", { name: "Plan" });
  const shaping = row("Task #12 Document it, Shaping");
  fireEvent.click(shaping.getByRole("button", { name: "Move to Ready" }));
  await waitFor(() => expect(calls).toEqual([{ name: "move_to_ready", arguments: { project: "sandbox", issues: [12] } }]));
  expect(shaping.getByRole("status")).toHaveTextContent("Moving #12 to Ready…");
  expect(shaping.getByRole("button", { name: "Move to Ready" })).toBeDisabled();
  moved.resolve(textResult({ moved: [12], status: "Ready" }));
  const ready = await screen.findByRole("listitem", { name: "Task #12 Document it, Ready" });
  expect(within(ready).getByRole("button", { name: "Back to Shaping" })).toBeInTheDocument();
  expect(within(ready).getByRole("button", { name: "Start run" })).toBeInTheDocument();
});

test("Start run calls start_run and shows the new run; without a project in the input, the call leaves it to the server", async () => {
  const { calls } = await mountView(startPlanList, {
    input: {},
    result: textResult(timeline),
    tools: {
      move_to_shaping: () => textResult({ moved: [11], status: "Shaping" }),
      start_run: () => textResult({ run_id: "9a9a9a9a-0000-4000-8000-000000000002", status: "queued", url: `${BASE}/projects/p1/runs/9a9a9a9a-0000-4000-8000-000000000002` }),
    },
  });
  await screen.findByRole("region", { name: "Plan" });
  fireEvent.click(row("Task #11 Write the tool, Ready").getByRole("button", { name: "Start run" }));
  await waitFor(() => expect(row("Task #11 Write the tool, Ready").getByRole("link", { name: "queued" })).toHaveAttribute("href", `${BASE}/projects/p1/runs/9a9a9a9a-0000-4000-8000-000000000002`));
  const started = row("Task #11 Write the tool, Ready");
  expect(started.getByRole("status")).toHaveTextContent("Run started.");
  // A task its run owns has no moves.
  expect(started.queryByRole("button", { name: "Back to Shaping" })).not.toBeInTheDocument();
  expect(calls).toEqual([{ name: "start_run", arguments: { issues: [11] } }]);
});

test("a refused move shows why and lets the person try again", async () => {
  await mountView(startPlanList, { input: { project: "sandbox" }, result: textResult(timeline), tools: { move_to_shaping: () => errorResult("The person declined this tool call.") } });
  await screen.findByRole("region", { name: "Plan" });
  const ready = row("Task #11 Write the tool, Ready");
  fireEvent.click(ready.getByRole("button", { name: "Back to Shaping" }));
  await waitFor(() => expect(ready.getByRole("alert")).toHaveTextContent("The person declined this tool call."));
  expect(ready.getByRole("button", { name: "Back to Shaping" })).toBeEnabled();
});

test("without a run to find the dashboard by, Open in Plan finds the project with list_projects", async () => {
  const plan = { ...timeline, epics: [{ ...timeline.epics[0]!, stories: [{ ...timeline.epics[0]!.stories[0]!, tasks: [task(12, "Document it", "Shaping")] }] }] };
  const { calls } = await mountView(startPlanList, { input: { project: "sandbox" }, result: textResult(plan), tools: { list_projects: () => textResult([{ name: "sandbox", id: "p1", repo: "octo/sample", url: `${BASE}/projects/p1` }]) } });
  await waitFor(() => expect(screen.getByRole("link", { name: "Open in Plan" })).toHaveAttribute("href", `${BASE}/projects/p1/plan`));
  expect(calls).toEqual([{ name: "list_projects", arguments: {} }]);
});

test("a host that does not proxy tool calls shows the plan without its buttons", async () => {
  await mountView(startPlanList, { input: { project: "sandbox" }, result: textResult(timeline), capabilities: { openLinks: {} } });
  await screen.findByRole("region", { name: "Plan" });
  expect(screen.queryByRole("button", { name: /Move to Ready|Back to Shaping|Start run/ })).not.toBeInTheDocument();
});

test("a tool error is shown as the error's text", async () => {
  await mountView(startPlanList, { input: { project: "sandbox" }, result: errorResult("There is no plan yet. Set one up with setup_plan.") });
  expect(await screen.findByRole("alert")).toHaveTextContent("There is no plan yet.");
});

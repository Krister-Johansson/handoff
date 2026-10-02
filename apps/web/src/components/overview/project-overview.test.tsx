import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Overview } from "@/server/overview";
import { ProjectOverview } from "./project-overview";
import { EMPTY_INBOX, minutesAgo, NOW, progress, QUIET, run, task } from "./testing/overview-fixtures";

vi.mock("@/app/inbox/actions", () => ({ answerAction: vi.fn(), repairAction: vi.fn(), cancelAction: vi.fn(), resolveLoopAction: vi.fn(), answerPermissionAction: vi.fn() }));
vi.mock("@/app/projects/actions", () => ({ requestMergeAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn(), listGitHubProjectsAction: vi.fn(), setupPlanAction: vi.fn() }));

const PROJECT = { id: "p1", name: "handoff", repo: "Krister-Johansson/handoff" };
const START = { graphs: ["plan-review"], graphName: "plan-review" };

function show(overview: Overview) {
  return render(<ProjectOverview project={PROJECT} overview={overview} start={START} now={NOW} />);
}

const section = (name: string) => screen.getByRole("region", { name: new RegExp(`^${name}`) });

test("Needs you holds the project's question and permission cards with their buttons, and links to the Inbox", () => {
  show({
    ...QUIET,
    needsYou: {
      ...EMPTY_INBOX,
      questions: [
        {
          id: "q1",
          question: "Should the summary replace the issue body on the approval card, or sit above it?",
          options: ["Replace the body", "Sit above it"],
          runId: "r56",
          projectId: "p1",
          projectName: "handoff",
          task: "#56 Approval card summaries for shaping",
          nodeKey: "coder",
          reason: "needs_input",
          createdAt: minutesAgo(8),
        },
      ],
      permissions: [
        {
          id: "3f6b2a10-0000-4000-8000-000000000001",
          runId: "r70",
          nodeKey: "coder",
          toolName: "Bash",
          input: { command: "npx playwright install chromium" },
          createdAt: minutesAgo(3),
          projectId: "p1",
          projectName: "handoff",
          task: "#70 Speak replies with a Stop control",
        },
      ],
    },
  });
  const needsYou = section("Needs you");
  expect(within(needsYou).getByRole("heading", { level: 2 })).toHaveTextContent("Needs you2");
  expect(within(needsYou).getByRole("link", { name: "Open the Inbox" })).toHaveAttribute("href", "/inbox?project=p1");
  expect(within(needsYou).getByRole("button", { name: "Replace the body" })).toBeInTheDocument();
  expect(within(needsYou).getByRole("button", { name: "Allow once" })).toBeInTheDocument();
  expect(within(needsYou).getByRole("link", { name: "#70 Speak replies with a Stop control" })).toHaveAttribute("href", "/projects/p1/runs/r70");
  // The page is the project, so the cards leave its name out.
  expect(within(needsYou).queryByRole("link", { name: "handoff" })).not.toBeInTheDocument();
});

test("Running now lists each active run with its status, cost, what it does now, the time in its step and its steps so far", () => {
  show({
    ...QUIET,
    running: [
      run({
        id: "r55",
        task: "#55 Shaping tools in the catalog",
        line: {
          graph: "plan-review",
          version: 11,
          costUsd: 1.84,
          now: { tone: "active", text: "Coder is working" },
          steps: [
            { nodeKey: "planner", status: "passed", times: 2 },
            { nodeKey: "coder", status: "running", times: 1 },
          ],
          stepSince: minutesAgo(11),
        },
      }),
      run({
        id: "r70",
        task: "#70 Speak replies with a Stop control",
        createdAt: minutesAgo(40),
        needsYou: true,
        line: { graph: "plan-review", version: 11, costUsd: 0.92, now: { tone: "attention", text: "Coder asks to run a command" }, steps: [], stepSince: minutesAgo(2) },
      }),
    ],
  });
  const running = section("Running now");
  expect(within(running).getByRole("heading", { level: 2 })).toHaveTextContent("Running now2");
  expect(within(running).getByRole("link", { name: "All runs" })).toHaveAttribute("href", "/projects/p1/runs");
  const [first, second] = within(running).getAllByRole("listitem", { name: /^#/ });
  expect(within(first!).getByRole("link", { name: "#55 Shaping tools in the catalog" })).toHaveAttribute("href", "/projects/p1/runs/r55");
  expect(first).toHaveTextContent("running");
  expect(first).toHaveTextContent("$1.84 · 14 minutes ago");
  expect(first).toHaveTextContent(/Coder is working\s*· 11 min/);
  const steps = within(first!).getByRole("list", { name: "Steps so far" });
  expect(within(steps).getAllByRole("listitem").map((s) => s.textContent)).toEqual(["planner ×2", "coder"]);
  // A run that waits on a person carries the Needs you chip, which leads to its card above.
  expect(second).toHaveTextContent("Coder asks to run a command");
  expect(within(second!).getByRole("link", { name: "Needs you" })).toHaveAttribute("href", "#needs-you");
});

test("with no run active, Running now says so in one line", () => {
  show(QUIET);
  const running = section("Running now");
  expect(within(running).getByRole("heading", { level: 2 })).toHaveTextContent(/^Running now$/);
  expect(within(running).getByText("Nothing is running")).toBeInTheDocument();
  expect(within(running).getByText("Start a run from an issue to do, or with New run.")).toBeInTheDocument();
});

test("Finished in the last day lists the runs that succeeded, with their merged pull request, cost and when they finished", () => {
  show({
    ...QUIET,
    finished: [
      run({
        id: "r53",
        task: "#53 Plan read model and the Ready gate",
        status: "succeeded",
        prNumber: 84,
        finishedAt: minutesAgo(18 * 60),
        line: { graph: "plan-review", version: 11, costUsd: 5.1, now: { tone: "success", text: "Done. PR #84 merged." }, steps: [], stepSince: null },
      }),
    ],
  });
  const finished = section("Finished in the last day");
  expect(within(finished).getByRole("heading", { level: 2 })).toHaveTextContent("Finished in the last day1");
  const [row] = within(finished).getAllByRole("listitem");
  expect(within(row!).getByRole("link", { name: "#53 Plan read model and the Ready gate" })).toHaveAttribute("href", "/projects/p1/runs/r53");
  expect(within(row!).getByRole("link", { name: "PR #84" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/handoff/pull/84");
  expect(row).toHaveTextContent("succeeded");
  expect(row).toHaveTextContent("$5.10 · 18 hours ago");
  expect(row).toHaveTextContent("Done. PR #84 merged.");
});

test("Finished in the last day shows the five latest runs and links to the rest", () => {
  const runs = Array.from({ length: 7 }, (_, i) => run({ id: `r${i}`, task: `#${i} Task ${i}`, status: "succeeded", finishedAt: minutesAgo(60 * (i + 1)) }));
  show({ ...QUIET, finished: runs });
  const finished = section("Finished in the last day");
  expect(within(finished).getByRole("heading", { level: 2 })).toHaveTextContent("Finished in the last day7");
  expect(within(finished).getAllByRole("listitem", { name: /^#/ }).map((r) => r.getAttribute("aria-labelledby"))).toEqual(["run-r0", "run-r1", "run-r2", "run-r3", "run-r4"]);
  expect(within(finished).getByRole("link", { name: "2 more in Runs" })).toHaveAttribute("href", "/projects/p1/runs");
});

test("with no run finished in the last day, the section says so in one line", () => {
  show(QUIET);
  const finished = section("Finished in the last day");
  expect(within(finished).getByRole("heading", { level: 2 })).toHaveTextContent(/^Finished in the last day$/);
  expect(within(finished).getByText("No run finished in the last day")).toBeInTheDocument();
  expect(within(finished).getByText("Runs that end show here for a day after they finish.")).toBeInTheDocument();
});

test("Features in progress shows each epic's progress and counts by status, and only its tasks running or in review", () => {
  if (QUIET.work.kind !== "plan") throw new Error("expected the plan");
  show({
    ...QUIET,
    work: {
      ...QUIET.work,
      features: [
        {
          number: 12,
          title: "Project management",
          url: "https://github.com/Krister-Johansson/handoff/issues/12",
          progress: progress({ Done: 3, "In review": 1, Running: 2, Ready: 1, Shaping: 1 }),
          tasks: [
            { ...task(54, "Status writes from runs", { status: "In review", prNumbers: [88] }), needsYou: false },
            { ...task(55, "Shaping tools in the catalog", { status: "Running", run: { id: "r55", status: "running", prNumber: null } }), needsYou: false },
            { ...task(56, "Approval card summaries for shaping", { status: "Running", run: { id: "r56", status: "waiting", prNumber: null } }), needsYou: true },
          ],
        },
      ],
    },
  });
  const features = section("Features in progress");
  expect(within(features).getByRole("heading", { level: 2 })).toHaveTextContent("Features in progress1");
  expect(within(features).getByRole("link", { name: "Open the plan" })).toHaveAttribute("href", "/projects/p1/plan");
  const epic = within(features).getByRole("listitem", { name: /Project management/ });
  expect(within(epic).getByRole("link", { name: "Project management" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/handoff/issues/12");
  expect(epic).toHaveTextContent("3 of 8 done");
  expect(within(epic).getByRole("img", { name: "3 Done, 1 In review, 2 Running, 1 Ready, 1 Shaping" })).toBeInTheDocument();
  const rows = within(epic).getAllByRole("listitem");
  expect(rows.map((r) => within(r).getByRole("link", { name: /^#\d+/ }).textContent)).toEqual(["#54 Status writes from runs", "#55 Shaping tools in the catalog", "#56 Approval card summaries for shaping"]);
  expect(within(rows[0]!).getByRole("link", { name: "PR #88" })).toBeInTheDocument();
  expect(within(rows[1]!).getByRole("link", { name: "running" })).toHaveAttribute("href", "/projects/p1/runs/r55");
  expect(within(rows[2]!).getByRole("link", { name: "Needs you" })).toHaveAttribute("href", "#needs-you");
});

test("with no epic moving, Features in progress says so in one line", () => {
  show(QUIET);
  const features = section("Features in progress");
  expect(within(features).getByRole("heading", { level: 2 })).toHaveTextContent(/^Features in progress$/);
  expect(within(features).getByText("No feature in progress")).toBeInTheDocument();
});

test("Ready to start lists the Ready tasks with their epic: Start run on one that can start, its blocker on one that cannot", () => {
  if (QUIET.work.kind !== "plan") throw new Error("expected the plan");
  show({
    ...QUIET,
    work: {
      ...QUIET.work,
      ready: [
        { ...task(58, "Plan page tree and board"), epic: "Project management" },
        { ...task(72, "Voice picker with local voices first", { blockedBy: [70] }), epic: "Voice" },
      ],
      unplannedToDo: 2,
    },
  });
  const ready = section("Ready to start");
  expect(within(ready).getByRole("heading", { level: 2 })).toHaveTextContent("Ready to start2");
  expect(within(ready).getByRole("link", { name: "Open Issues" })).toHaveAttribute("href", "/projects/p1/issues");
  const [tree, picker] = within(ready).getAllByRole("listitem", { name: /^#/ });
  expect(tree).toHaveTextContent("Project management");
  expect(within(tree!).getByRole("button", { name: "Start run" })).toBeEnabled();
  expect(picker).toHaveTextContent("Voice");
  expect(picker).toHaveTextContent("Blocked by#70");
  expect(within(picker!).queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
  expect(within(ready).getByRole("link", { name: "2 unplanned issues" })).toHaveAttribute("href", "/projects/p1/issues");
  expect(ready).toHaveTextContent("2 unplanned issues outside the plan can start too.");
});

test("with no Ready task, Ready to start says so in one line", () => {
  show(QUIET);
  const ready = section("Ready to start");
  expect(within(ready).getByRole("heading", { level: 2 })).toHaveTextContent(/^Ready to start$/);
  expect(within(ready).getByText("No task is ready")).toBeInTheDocument();
});

const issue = (number: number, title: string, run: { id: string; status: string } | null) => ({
  number,
  title,
  url: `https://github.com/example-org/example-shop/issues/${number}`,
  labels: [],
  author: null,
  updatedAt: "2026-10-01T10:00:00Z",
  blockedBy: [],
  run: run && { ...run, prNumber: null },
  plan: null,
});

test("without a plan, Open issues with runs takes the place of the features, with a pointer to set up the plan", () => {
  show({
    ...QUIET,
    work: {
      kind: "issues",
      reason: "no-plan",
      error: "This project has no plan on GitHub yet.",
      issues: { withRuns: [issue(3, "F03 Prisma schema and first migration", { id: "r3", status: "waiting" }), issue(5, "F05 User model and sessions", { id: "r5", status: "failed" })], toDo: [] },
    },
  });
  expect(screen.queryByRole("region", { name: /^Features in progress/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: /^Ready to start/ })).not.toBeInTheDocument();
  const issues = section("Open issues with runs");
  expect(within(issues).getByRole("heading", { level: 2 })).toHaveTextContent("Open issues with runs2");
  expect(within(issues).getByRole("link", { name: "Open Issues" })).toHaveAttribute("href", "/projects/p1/issues");
  const [schema, sessions] = within(issues).getAllByRole("listitem", { name: /^#/ });
  expect(within(schema!).getByRole("link", { name: "#3 F03 Prisma schema and first migration" })).toHaveAttribute("href", "https://github.com/example-org/example-shop/issues/3");
  expect(within(schema!).getByRole("link", { name: "waiting" })).toHaveAttribute("href", "/projects/p1/runs/r3");
  expect(within(sessions!).getByRole("link", { name: "failed" })).toHaveAttribute("href", "/projects/p1/runs/r5");
  expect(within(issues).getByText("No plan on GitHub yet")).toBeInTheDocument();
  expect(within(issues).getByText("Link a GitHub Project to follow epics, their progress and the Ready tasks on this page.")).toBeInTheDocument();
  expect(within(issues).getByRole("button", { name: "Set up the plan" })).toBeInTheDocument();
});

test("without a plan and with no issue run yet, Issues to do lists the issues with Start run", () => {
  show({
    ...QUIET,
    work: { kind: "issues", reason: "no-plan", error: "", issues: { withRuns: [], toDo: [issue(12, "Add rate limiting to the webhook endpoint", { id: "r12", status: "cancelled" })] } },
  });
  expect(screen.queryByRole("region", { name: /^Open issues with runs/ })).not.toBeInTheDocument();
  const toDo = section("Issues to do");
  expect(within(toDo).getByRole("heading", { level: 2 })).toHaveTextContent("Issues to do1");
  const [row] = within(toDo).getAllByRole("listitem", { name: /^#/ });
  expect(row).toHaveTextContent("Last run cancelled");
  expect(within(row!).getByRole("button", { name: "Start run" })).toBeInTheDocument();
  expect(within(toDo).getByRole("button", { name: "Set up the plan" })).toBeInTheDocument();
});

test("when the plan cannot be read, the issues section says why instead of offering to set one up", () => {
  show({ ...QUIET, work: { kind: "issues", reason: "no-scope", error: "GITHUB_TOKEN lacks the project scope.", issues: { error: "Set GITHUB_TOKEN or a GitHub App for the dashboard to list the repository's issues." } } });
  const toDo = section("Issues to do");
  expect(within(toDo).getByText("Set GITHUB_TOKEN or a GitHub App for the dashboard to list the repository's issues.")).toBeInTheDocument();
  expect(within(toDo).getByText("GITHUB_TOKEN lacks the project scope.")).toBeInTheDocument();
  expect(within(toDo).queryByRole("button", { name: "Set up the plan" })).not.toBeInTheDocument();
});

test("with nothing waiting, Needs you keeps its heading without a count and says so in one line", () => {
  show(QUIET);
  const needsYou = section("Needs you");
  expect(within(needsYou).getByRole("heading", { level: 2 })).toHaveTextContent(/^Needs you$/);
  expect(within(needsYou).getByText("Nothing needs you")).toBeInTheDocument();
});

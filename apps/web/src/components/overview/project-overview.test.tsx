import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { Overview } from "@/server/overview";
import { ProjectOverview } from "./project-overview";
import { EMPTY_INBOX, minutesAgo, NOW, QUIET, run } from "./testing/overview-fixtures";

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

test("with nothing waiting, Needs you keeps its heading without a count and says so in one line", () => {
  show(QUIET);
  const needsYou = section("Needs you");
  expect(within(needsYou).getByRole("heading", { level: 2 })).toHaveTextContent(/^Needs you$/);
  expect(within(needsYou).getByText("Nothing needs you")).toBeInTheDocument();
});

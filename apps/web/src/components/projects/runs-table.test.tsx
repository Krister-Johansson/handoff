import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { RunsTable } from "./runs-table";

const now = new Date("2026-10-01T12:00:00Z");
const base = { projectId: "p1", issues: [], branchName: "handoff/7-crud", createdAt: new Date("2026-10-01T09:00:00Z") };

test("a run row shows its task, what it is doing, graph version, branch, cost, start and status", () => {
  const lines = new Map([["r1", { graph: "plan-review", version: 11, costUsd: 2.41, now: { tone: "active" as const, text: "Code is working, attempt 2" } }]]);
  render(
    <RunsTable
      runs={[{ ...base, id: "r1", task: "Todo CRUD", status: "running", prNumber: null, issues: [{ number: 7, title: "CRUD", url: "https://github.com/o/r/issues/7" }] }]}
      lines={lines}
      repoUrl="https://github.com/o/r"
      now={now}
    />,
  );
  const row = screen.getAllByRole("row")[1]!;
  expect(within(row).getByRole("link", { name: "Todo CRUD" })).toHaveAttribute("href", "/projects/p1/runs/r1");
  expect(within(row).getByRole("link", { name: "#7 CRUD" })).toBeInTheDocument();
  expect(within(row).getByText("Code is working, attempt 2")).toBeInTheDocument();
  expect(within(row).getByText("plan-review v11")).toBeInTheDocument();
  expect(within(row).getByText("handoff/7-crud")).toBeInTheDocument();
  expect(within(row).getByText("none")).toBeInTheDocument();
  expect(within(row).getByText("$2.41")).toBeInTheDocument();
  expect(within(row).getByText("3 hours ago")).toBeInTheDocument();
  expect(within(row).getByText("running")).toBeInTheDocument();
});

test("a running run whose step waits on a permission request says so in its status", () => {
  const lines = new Map([
    [
      "r5",
      {
        graph: "linear",
        version: 3,
        costUsd: 0,
        now: { tone: "attention" as const, text: "Code asks to run a command" },
        waitingOn: { kind: "permission" as const, nodeKey: "coder", since: new Date("2026-10-01T11:30:00Z") },
      },
    ],
  ]);
  render(<RunsTable runs={[{ ...base, id: "r5", task: "Wire the API", status: "running", prNumber: null }]} lines={lines} repoUrl="https://github.com/o/r" now={now} />);
  const row = screen.getAllByRole("row")[1]!;
  expect(within(row).getByText("waiting on permission")).toBeInTheDocument();
  expect(within(row).queryByText("running")).not.toBeInTheDocument();
});

test("a run the scheduler started carries the Scheduler tag", () => {
  const lines = new Map<string, never>();
  render(
    <RunsTable
      runs={[
        { ...base, id: "r3", task: "Scheduled task", status: "queued", prNumber: null, startedBy: "scheduler" },
        { ...base, id: "r4", task: "Started by hand", status: "queued", prNumber: null, startedBy: "dashboard" },
      ]}
      lines={lines}
      repoUrl="https://github.com/o/r"
      now={now}
    />,
  );
  const [, scheduled, byHand] = screen.getAllByRole("row");
  expect(within(scheduled!).getByText("Scheduler")).toBeInTheDocument();
  expect(within(byHand!).queryByText("Scheduler")).not.toBeInTheDocument();
});

test("a run with a pull request links to it on GitHub", () => {
  const lines = new Map([["r2", { graph: "linear", version: 3, costUsd: 0, now: { tone: "success" as const, text: "Done. PR #48 merged." } }]]);
  render(<RunsTable runs={[{ ...base, id: "r2", task: "Scaffold", status: "succeeded", prNumber: 48 }]} lines={lines} repoUrl="https://github.com/o/r" now={now} />);
  expect(screen.getByRole("link", { name: "#48" })).toHaveAttribute("href", "https://github.com/o/r/pull/48");
  expect(screen.getByText("Done. PR #48 merged.")).toBeInTheDocument();
});

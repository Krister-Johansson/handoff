import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { activeSummary, needsYouSummary } from "@/lib/overview-summary";
import { ActiveRunList } from "./active-runs";

const now = new Date("2026-10-01T12:00:00Z");
const run = (id: string, status: string, prNumber: number | null = null) => ({
  id,
  projectId: "p1",
  task: `Task ${id}`,
  status,
  project: "sandbox",
  prNumber,
  createdAt: new Date("2026-10-01T11:48:00Z"),
});

test("an active run shows its status, what it is doing, its project and how long ago it started", () => {
  const lines = new Map([["r1", { graph: "linear", version: 3, costUsd: 0, now: { tone: "active" as const, text: "Code is working, attempt 2" } }]]);
  render(<ActiveRunList runs={[run("r1", "running")]} lines={lines} now={now} />);
  const row = screen.getByRole("listitem");
  expect(within(row).getByRole("link", { name: "Task r1" })).toHaveAttribute("href", "/projects/p1/runs/r1");
  expect(within(row).getByText("running")).toBeInTheDocument();
  expect(within(row).getByText("Code is working, attempt 2 · 12 minutes ago")).toBeInTheDocument();
  expect(within(row).getByText("sandbox")).toBeInTheDocument();
});

test("a run waiting on a review offers to open it, and a run with a pull request shows its number", () => {
  const lines = new Map([
    ["r1", { graph: "g", version: 1, costUsd: 0, now: { tone: "attention" as const, text: "Plan waits for your review" }, reviewHref: "/projects/p1/runs/r1/review/q1" }],
    ["r2", { graph: "g", version: 1, costUsd: 0, now: { tone: "attention" as const, text: "Waiting for CI and reviews on PR #61" } }],
  ]);
  render(<ActiveRunList runs={[run("r1", "waiting"), run("r2", "waiting", 61)]} lines={lines} now={now} />);
  const [review, pr] = screen.getAllByRole("listitem");
  expect(within(review!).getByRole("link", { name: "Open the review" })).toHaveAttribute("href", "/projects/p1/runs/r1/review/q1");
  expect(within(pr!).getByText("#61")).toBeInTheDocument();
  expect(within(pr!).queryByRole("link", { name: "Open the review" })).not.toBeInTheDocument();
});

test("the stat lines count what needs you and what the active runs are doing", () => {
  expect(needsYouSummary({ questions: [{ context: { review: {} } }, { context: {} }, { context: {} }], failedRuns: [{}] })).toBe("1 review · 2 questions · 1 failed run");
  expect(needsYouSummary({ questions: [], failedRuns: [] })).toBe("");
  expect(activeSummary([run("a", "running"), run("b", "waiting"), run("c", "waiting"), run("d", "queued")])).toBe("1 running · 2 waiting · 1 queued");
});

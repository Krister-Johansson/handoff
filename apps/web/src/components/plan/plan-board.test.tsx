import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PlanBoard } from "./plan-board";
import { epic, planView, PROJECT, REPO_URL, run, story, task } from "./testing/plan-fixtures";

vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn() }));

const NOW = Date.parse("2026-10-02T12:00:00Z");
const base = { projectId: "p1", repoUrl: REPO_URL, project: PROJECT, needsYou: [] as string[], graphs: ["loop"], graphName: "loop", now: NOW };
const column = (name: string) => screen.getByRole("region", { name });
const card = (col: HTMLElement, name: RegExp) => within(col).getByRole("listitem", { name });

test("the board puts each task in its status column with the epic as its eyebrow and closed tasks in Done", () => {
  const view = planView(
    [
      epic(12, "Project management", [
        story(41, "Shaping", 12, [
          task(55, "Shaping tools", "Running", { run: run("r5", "running") }),
          task(57, "Add the migration", "Shaping", { blockedBy: [55] }),
          task(59, "Context packet", "Ready", { state: "closed", prNumbers: [79] }),
        ]),
      ]),
      epic(10, "Voice", [story(18, "Voice settings", 10, [task(72, "Voice picker", "Ready")])]),
    ],
    { unparented: [task(61, "Rate limit back-off", "In review", { parent: 34 })] },
  );
  render(<PlanBoard {...base} board={view.board} epics={view.epics} />);

  expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Shaping", "Ready", "Running", "In review", "Done"]);
  expect(within(column("Shaping")).getByText("1")).toBeInTheDocument();

  const migration = card(column("Shaping"), /#57 Add the migration/);
  expect(within(migration).getByText("Project management")).toBeInTheDocument();
  expect(within(migration).getByRole("link", { name: "#57 Add the migration" })).toHaveAttribute("href", `${REPO_URL}/issues/57`);
  expect(within(migration).getByText(/Blocked by/)).toBeInTheDocument();

  expect(within(card(column("Ready"), /#72 Voice picker/)).getByText("Voice")).toBeInTheDocument();
  expect(within(column("Running")).getByRole("link", { name: /running/ })).toHaveAttribute("href", "/projects/p1/runs/r5");
  expect(within(card(column("In review"), /#61/)).getByText("parent #34 is not in the plan")).toBeInTheDocument();

  const done = card(column("Done"), /#59 Context packet/);
  expect(within(done).getByRole("link", { name: "PR #79" })).toHaveAttribute("href", `${REPO_URL}/pull/79`);
  expect(within(column("Ready")).queryByText(/#59/)).not.toBeInTheDocument();
  expect(within(column("Ready")).queryByText(/Move tasks here/)).not.toBeInTheDocument();
  expect(within(column("Running")).queryByText(/Start a run from a Ready task/)).not.toBeInTheDocument();
});

test("the Done column shows the last 30 days and Show all reveals the rest", () => {
  const done = (n: number, updatedAt: string) => task(n, `Done ${n}`, "Done", { state: "closed", updatedAt });
  const view = planView([
    epic(12, "Project management", [story(40, "Read the plan", 12, [done(52, "2026-09-30T08:00:00Z"), done(53, "2026-08-01T08:00:00Z"), done(54, "2026-09-10T08:00:00Z")])]),
  ]);
  render(<PlanBoard {...base} board={view.board} epics={view.epics} />);

  const col = column("Done");
  expect(within(col).getByText("3")).toBeInTheDocument();
  expect(within(col).getAllByRole("listitem").map((li) => li.getAttribute("aria-label"))).toEqual(["#52 Done 52", "#54 Done 54"]);
  expect(within(col).getByText("Last 30 days, 2 of 3")).toBeInTheDocument();
  fireEvent.click(within(col).getByRole("button", { name: "Show all" }));
  expect(within(col).getAllByRole("listitem")).toHaveLength(3);
  expect(within(col).queryByText(/Last 30 days/)).not.toBeInTheDocument();

  expect(within(column("Ready")).getByText("Move tasks here when they are shaped. Only Ready tasks reach the backlog.")).toBeInTheDocument();
  expect(within(column("Running")).getByText("Start a run from a Ready task.")).toBeInTheDocument();
});

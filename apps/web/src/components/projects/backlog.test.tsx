import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Backlog } from "./backlog";

const actions = vi.hoisted(() => ({
  startRunAction: vi.fn(async () => ({})),
  listIssuesAction: vi.fn(async () => ({ issues: [] })),
  createGraphAction: vi.fn(),
  deleteGraphAction: vi.fn(),
  renameGraphAction: vi.fn(),
}));
vi.mock("@/app/projects/actions", () => actions);


const issue = (number: number, title: string, run: { id: string; status: string; prNumber: number | null } | null = null) => ({
  number,
  title,
  url: `https://github.com/o/r/issues/${number}`,
  labels: ["bug"],
  author: "ann",
  updatedAt: "2026-09-30T08:00:00Z",
  blockedBy: [] as number[],
  run,
});

test("an issue nobody works on offers Start run, which opens New run with the issue linked", async () => {
  render(<Backlog projectId="p1" graphs={["loop"]} graphName="loop" filter="todo" counts={{ todo: 1, started: 1, all: 2 }} issues={[issue(12, "Slugify drops digits")]} />);
  const row = screen.getByRole("listitem");
  expect(within(row).getByRole("link", { name: /#12/ })).toHaveAttribute("href", "https://github.com/o/r/issues/12");
  expect(within(row).getByText("bug")).toBeInTheDocument();
  fireEvent.click(within(row).getByRole("button", { name: "Start run" }));
  const linked = await screen.findByRole("list", { name: "Linked issues" });
  expect(within(linked).getByText("#12 Slugify drops digits")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start run" }));
  await waitFor(() => expect(actions.startRunAction).toHaveBeenCalledTimes(1));
  expect(((actions.startRunAction.mock.calls[0] as unknown[])[1] as FormData).getAll("issue")).toEqual(["12"]);
});

test("an issue with a run shows the run's status and links to it and its PR", () => {
  render(
    <Backlog
      projectId="p1"
      graphs={["loop"]}
      graphName="loop"
      filter="started"
      counts={{ todo: 0, started: 1, all: 1 }}
      issues={[issue(14, "Document slugify", { id: "r9", status: "waiting", prNumber: 21 })]}
      repoUrl="https://github.com/o/r"
    />,
  );
  const row = screen.getByRole("listitem");
  expect(within(row).getByRole("link", { name: /waiting/ })).toHaveAttribute("href", "/projects/p1/runs/r9");
  expect(within(row).getByRole("link", { name: "PR #21" })).toHaveAttribute("href", "https://github.com/o/r/pull/21");
  expect(within(row).queryByRole("button", { name: "Start run" })).not.toBeInTheDocument();
});

test("the filters link to To do, Started and All with counts", () => {
  render(<Backlog projectId="p1" graphs={["loop"]} graphName="loop" filter="todo" counts={{ todo: 3, started: 2, all: 5 }} issues={[]} />);
  expect(screen.getByRole("link", { name: "To do 3" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Started 2" })).toHaveAttribute("href", "?tab=issues&issues=started");
  expect(screen.getByText(/Nothing to do/)).toBeInTheDocument();
});

test("an issue GitHub says is blocked shows what blocks it, and can still be started to wait for it", () => {
  render(
    <Backlog
      projectId="p1"
      graphs={["loop"]}
      graphName="loop"
      filter="todo"
      counts={{ todo: 1, started: 0, all: 1 }}
      repoUrl="https://github.com/o/r"
      issues={[{ ...issue(7, "Board view"), blockedBy: [5, 6] }]}
    />,
  );
  const row = screen.getAllByRole("listitem")[0]!;
  expect(within(row).getByText("Blocked by")).toBeInTheDocument();
  expect(within(row).getByRole("link", { name: "#5" })).toHaveAttribute("href", "https://github.com/o/r/issues/5");
  expect(within(row).getByRole("link", { name: "#6" })).toHaveAttribute("href", "https://github.com/o/r/issues/6");
  expect(within(row).getByRole("button", { name: /Start run/ })).toBeInTheDocument();
});

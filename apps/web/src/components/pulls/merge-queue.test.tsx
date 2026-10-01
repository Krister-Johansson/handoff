import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { MergeQueue, type QueueRow } from "./merge-queue";

const actions = vi.hoisted(() => ({ requestMergeAction: vi.fn(), requestMergeAllAction: vi.fn() }));
vi.mock("@/app/projects/actions", () => actions);
beforeEach(() => {
  actions.requestMergeAction.mockReset().mockResolvedValue({ ok: true });
  actions.requestMergeAllAction.mockReset().mockResolvedValue({ ok: true });
});

const row = (n: number, extra: Partial<QueueRow> = {}): QueueRow => ({
  runId: `r${n}`,
  task: `#${n} F0${n} Task ${n}`,
  prNumber: 50 + n,
  issues: [],
  queuedAt: new Date(`2026-10-01T10:0${n}:00Z`),
  requested: false,
  position: n,
  waiting: true,
  mode: "manual",
  ...extra,
});

test("ready pull requests are listed in the order they will merge, with Merge on the first", () => {
  render(<MergeQueue projectId="p1" repoUrl="https://github.com/o/r" rows={[row(1), row(2), row(3, { waiting: false })]} />);
  const items = screen.getAllByRole("listitem");
  expect(items.map((i) => within(i).getByRole("link", { name: /Task/ }).textContent)).toEqual(["#1 F01 Task 1", "#2 F02 Task 2", "#3 F03 Task 3"]);
  expect(within(items[0]!).getByRole("link", { name: "#51" })).toHaveAttribute("href", "https://github.com/o/r/pull/51");
  expect(within(items[0]!).getByText("Ready")).toBeInTheDocument();
  expect(within(items[2]!).getByText("Catching up with main")).toBeInTheDocument();
  // Only the first can merge now; the rest wait their turn.
  expect(within(items[0]!).getByRole("button", { name: "Merge #51" })).toBeInTheDocument();
  expect(within(items[1]!).queryByRole("button")).not.toBeInTheDocument();
});

test("Merge asks to merge the first; Merge all asks for every one in order", async () => {
  render(<MergeQueue projectId="p1" repoUrl="https://github.com/o/r" rows={[row(1), row(2)]} />);
  fireEvent.click(screen.getByRole("button", { name: "Merge #51" }));
  await waitFor(() => expect(actions.requestMergeAction).toHaveBeenCalledWith({ runId: "r1", projectId: "p1" }));
  const all = screen.getByRole("button", { name: "Merge all in order" });
  await waitFor(() => expect(all).toBeEnabled());
  fireEvent.click(all);
  await waitFor(() => expect(actions.requestMergeAllAction).toHaveBeenCalledWith({ projectId: "p1" }));
});

test("requested and automatic merges say so and need no button", () => {
  render(<MergeQueue projectId="p1" repoUrl="https://github.com/o/r" rows={[row(1, { requested: true }), row(2, { mode: "auto" })]} />);
  const items = screen.getAllByRole("listitem");
  expect(within(items[0]!).getByText("Merging next")).toBeInTheDocument();
  expect(within(items[1]!).getByText("Merges on its own in turn")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Merge/ })).not.toBeInTheDocument();
});

test("an empty queue shows nothing", () => {
  const { container } = render(<MergeQueue projectId="p1" repoUrl="https://github.com/o/r" rows={[]} />);
  expect(container).toBeEmptyDOMElement();
});

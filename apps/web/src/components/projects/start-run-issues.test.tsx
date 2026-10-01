import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { StartRunDialog } from "./forms";

const actions = vi.hoisted(() => ({
  startRunAction: vi.fn(async () => ({})),
  listIssuesAction: vi.fn(),
  createGraphAction: vi.fn(),
  deleteGraphAction: vi.fn(),
  renameGraphAction: vi.fn(),
}));
vi.mock("@/app/projects/actions", () => actions);

beforeEach(() => {
  actions.startRunAction.mockClear();
  actions.listIssuesAction.mockReset();
});

const issue = (number: number, title: string, blockedBy: number[] = []) => ({ number, title, url: `https://github.com/o/r/issues/${number}`, labels: [], author: "ann", updatedAt: "", blockedBy });

async function openDialog() {
  render(<StartRunDialog projectId="p1" graphs={["loop"]} graphName="loop" label="New run" />);
  fireEvent.click(screen.getByRole("button", { name: "New run" }));
  return screen.findByRole("combobox", { name: "Issues" });
}

test("linking issues lets the task stay empty and sends the issue numbers", async () => {
  actions.listIssuesAction.mockResolvedValue({ issues: [issue(12, "Slugify drops digits"), issue(14, "Document slugify")] });
  fireEvent.click(await openDialog());
  fireEvent.change(await screen.findByPlaceholderText("Search issues"), { target: { value: "slugify drops" } });
  fireEvent.click(screen.getByRole("option", { name: /#12 Slugify drops digits/ }));
  const chosen = screen.getByRole("list", { name: "Linked issues" });
  expect(within(chosen).getByText("#12 Slugify drops digits")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start run" }));
  await waitFor(() => expect(actions.startRunAction).toHaveBeenCalledTimes(1));
  const form = (actions.startRunAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.getAll("issue")).toEqual(["12"]);
  expect(form.get("task")).toBe("");
});

test("a linked issue can be removed again", async () => {
  actions.listIssuesAction.mockResolvedValue({ issues: [issue(12, "Slugify drops digits")] });
  fireEvent.click(await openDialog());
  fireEvent.click(await screen.findByRole("option", { name: /#12/ }));
  fireEvent.click(screen.getByRole("button", { name: "Remove #12" }));
  expect(screen.queryByRole("list", { name: "Linked issues" })).not.toBeInTheDocument();
});

test("without GitHub access the dialog says so and still starts a run from a task", async () => {
  actions.listIssuesAction.mockResolvedValue({ error: "GitHub is not configured" });
  render(<StartRunDialog projectId="p1" graphs={["loop"]} graphName="loop" label="New run" />);
  fireEvent.click(screen.getByRole("button", { name: "New run" }));
  expect(await screen.findByText(/GitHub is not configured/)).toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Issues" })).not.toBeInTheDocument();
});

test("an issue blocked on GitHub cannot be linked, and says what blocks it", async () => {
  actions.listIssuesAction.mockResolvedValue({ issues: [issue(7, "Board view", [5, 6])] });
  fireEvent.click(await openDialog());
  const option = await screen.findByRole("option", { name: /#7 Board view/ });
  expect(option).toHaveAttribute("aria-disabled", "true");
  expect(option).toHaveTextContent("blocked by #5, #6");
  fireEvent.click(option);
  expect(screen.queryByRole("list", { name: "Linked issues" })).not.toBeInTheDocument();
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { NewGraphDialog, StartRunDialog } from "./forms";

const actions = vi.hoisted(() => ({
  createGraphAction: vi.fn(async () => ({})),
  startRunAction: vi.fn(async () => ({})),
  deleteGraphAction: vi.fn(),
  renameGraphAction: vi.fn(),
}));
vi.mock("@/app/projects/actions", () => actions);

const templates = [
  { value: "loop", label: "Plan, code, test, review, PR, merge with retry loops" },
  { value: "linear", label: "Plan, code, PR, merge" },
];

test("New graph opens a dialog that creates a graph from a template", async () => {
  render(<NewGraphDialog projectId="p1" templates={templates} />);
  fireEvent.click(screen.getByRole("button", { name: "New graph" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "main" } });
  fireEvent.change(screen.getByLabelText("Start from"), { target: { value: "linear" } });
  fireEvent.click(screen.getByRole("button", { name: "Create graph" }));
  await waitFor(() => expect(actions.createGraphAction).toHaveBeenCalledTimes(1));
  const form = (actions.createGraphAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(Object.fromEntries(form)).toEqual({ projectId: "p1", name: "main", template: "linear" });
});

test("New run lets you pick which graph runs the task", async () => {
  render(<StartRunDialog projectId="p1" graphs={["linear", "review-loop"]} graphName="review-loop" label="New run" />);
  fireEvent.click(screen.getByRole("button", { name: "New run" }));
  expect(screen.getByLabelText("Graph")).toHaveValue("review-loop");
  fireEvent.change(screen.getByLabelText("Graph"), { target: { value: "linear" } });
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Add a CHANGELOG.md" } });
  fireEvent.click(screen.getByRole("button", { name: "Start run" }));
  await waitFor(() => expect(actions.startRunAction).toHaveBeenCalledTimes(1));
  const form = (actions.startRunAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("graphName")).toBe("linear");
});

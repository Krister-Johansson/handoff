import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { StartRunDialog } from "./forms";

const startRunAction = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/app/projects/actions", () => ({
  startRunAction,
  listIssuesAction: vi.fn(async () => ({ issues: [] })),
  createGraphAction: vi.fn(),
  createProjectAction: vi.fn(),
  deleteGraphAction: vi.fn(),
  renameGraphAction: vi.fn(),
}));

test("Cmd or Ctrl+Enter in the task field starts the run", async () => {
  render(<StartRunDialog projectId="p1" graphName="loop" />);
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  const task = screen.getByLabelText("Task");
  fireEvent.change(task, { target: { value: "Add a slugify helper" } });
  fireEvent.keyDown(task, { key: "Enter", metaKey: true });
  await waitFor(() => expect(startRunAction).toHaveBeenCalledTimes(1));
  const form = (startRunAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("task")).toBe("Add a slugify helper");
  expect(form.get("graphName")).toBe("loop");
});

test("plain Enter in the task field adds a line instead of submitting", () => {
  startRunAction.mockClear();
  render(<StartRunDialog projectId="p1" graphName="loop" />);
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  fireEvent.keyDown(screen.getByLabelText("Task"), { key: "Enter" });
  expect(startRunAction).not.toHaveBeenCalled();
});

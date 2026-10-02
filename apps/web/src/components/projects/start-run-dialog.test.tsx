import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

test("the start run form carries toolname, tooldescription and a toolparamdescription per field, never toolautosubmit, and still submits through its action", async () => {
  startRunAction.mockClear();
  render(<StartRunDialog projectId="p1" graphName="loop" graphs={["loop", "linear"]} />);
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  const form = screen.getByRole("dialog").querySelector("form")!;
  expect(form).toHaveAttribute("toolname", "start_run_form");
  expect(form.getAttribute("tooldescription")).toMatch(/Starts a run/);
  expect(form).not.toHaveAttribute("toolautosubmit");
  expect(screen.getByLabelText("Graph")).toHaveAttribute("toolparamdescription", expect.stringContaining("graph"));
  expect(screen.getByLabelText("Task")).toHaveAttribute("toolparamdescription", expect.stringContaining("task"));
  fireEvent.change(screen.getByLabelText("Task"), { target: { value: "Add a slugify helper" } });
  fireEvent.click(screen.getByRole("button", { name: "Start run" }));
  await waitFor(() => expect(startRunAction).toHaveBeenCalledTimes(1));
  expect(((startRunAction.mock.calls[0] as unknown[])[1] as FormData).get("task")).toBe("Add a slugify helper");
});

test("while a browser agent fills the start run form the dialog says to check it before running", async () => {
  const context = new EventTarget();
  Object.defineProperty(document, "modelContext", { value: context, configurable: true });
  try {
    render(<StartRunDialog projectId="p1" graphName="loop" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.queryByText(/Filled by an agent/)).not.toBeInTheDocument();
    act(() => void context.dispatchEvent(Object.assign(new Event("toolactivated"), { toolName: "start_run_form" })));
    expect(await screen.findByText("Filled by an agent. Check it before you run.")).toBeInTheDocument();
    act(() => void context.dispatchEvent(Object.assign(new Event("toolcancel"), { toolName: "start_run_form" })));
    await waitFor(() => expect(screen.queryByText(/Filled by an agent/)).not.toBeInTheDocument());
  } finally {
    delete (document as { modelContext?: unknown }).modelContext;
  }
});

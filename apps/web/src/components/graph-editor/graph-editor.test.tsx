import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadGraphVersionAction, saveGraphAction } from "@/app/projects/actions";
import { GraphEditor } from "./graph-editor";

vi.mock("@/app/projects/actions", () => ({ loadGraphVersionAction: vi.fn(), saveGraphAction: vi.fn() }));

const document = {
  attributes: { startNode: "planner" },
  nodes: [{ key: "planner", attributes: { type: "planner", label: "Planner", config: {} } }],
  edges: [],
};
/** A Planner that hands its plan to a Coder: two nodes and the edge between them. */
const twoNodes = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", label: "Planner", x: 0, y: 0, config: {} } },
    { key: "coder", attributes: { type: "coder", label: "Coder", x: 300, y: 0, config: {} } },
  ],
  edges: [{ key: "planner->coder", source: "planner", target: "coder", attributes: { loop: false } }],
};
const versions = [
  { version: 4, createdAt: "2026-09-30T10:00:00.000Z", createdBy: "dashboard" },
  { version: 3, createdAt: "2026-09-29T10:00:00.000Z", createdBy: "cli" },
];

const renderEditor = (graph: unknown = document) =>
  render(
    <TooltipProvider>
      <GraphEditor
        projectId="p1"
        graphName="plan-review"
        version={3}
        document={graph}
        library={{ skills: [], mcp: [], agents: [], groups: [] }}
        versions={versions}
        trail={<nav>Projects</nav>}
      />
    </TooltipProvider>,
  );

test("the toolbar names the graph and its version, and says it is valid", () => {
  renderEditor();
  const toolbar = screen.getByRole("toolbar", { name: "Graph" });
  expect(toolbar).toHaveTextContent("plan-review");
  expect(toolbar).toHaveTextContent("v3");
  expect(toolbar).toHaveTextContent("valid");
  expect(screen.getByRole("button", { name: "Fit view" })).toBeInTheDocument();
});

test("an unsaved edit offers to save as the version after the newest one", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Coder" }));
  // The new Coder is not connected yet, so the graph has an issue and cannot be saved until it is.
  expect(screen.getByRole("button", { name: "Save as v5" })).toBeDisabled();
  expect(screen.getByRole("toolbar", { name: "Graph" })).toHaveTextContent(/\d+ issues?/);
});

test("the editor opens locked: the controls offer to unlock, the palette is disabled and the Graph help says how to unlock", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: "Unlock editing" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add Coder" })).toHaveAttribute("aria-disabled", "true");
  const inspector = screen.getByRole("complementary", { name: "Inspector" });
  expect(inspector).toHaveTextContent("The graph is locked");
  expect(inspector).toHaveTextContent("lock button");
});

test("the trail says when the shown version was saved and by whom", () => {
  renderEditor();
  expect(screen.getByText(/^v3 saved .+ by cli$/)).toBeInTheDocument();
});

test("the Version history button on the canvas controls opens a drawer that lists each version", () => {
  renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "Version history" }));
  const drawer = screen.getByRole("dialog", { name: "Version history" });
  const items = within(drawer).getAllByRole("listitem");
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent("v4");
  expect(items[0]).toHaveTextContent("2026-09-30 10:00");
  expect(within(items[0]!).getByRole("button", { name: "Restore" })).toBeEnabled();
  expect(items[1]).toHaveTextContent("v3");
  expect(items[1]).toHaveTextContent("current");
});

test("Restore in the drawer closes it and loads that version onto the canvas, unsaved", async () => {
  vi.mocked(loadGraphVersionAction).mockResolvedValue({
    attributes: { startNode: "planner" },
    nodes: [{ key: "planner", attributes: { type: "planner", label: "Old planner", config: {} } }],
    edges: [],
  });
  renderEditor();
  fireEvent.click(screen.getByRole("button", { name: "Version history" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "Version history" })).getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(screen.getByText("Showing v4, not saved yet")).toBeInTheDocument());
  expect(loadGraphVersionAction).toHaveBeenCalledWith("p1", "plan-review", 4);
  expect(screen.queryByRole("dialog", { name: "Version history" })).not.toBeInTheDocument();
  expect(screen.getByText("Old planner")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save as v5" })).toBeEnabled());
});

test("Escape closes the drawer and puts focus back on the Version history button", async () => {
  renderEditor();
  const button = screen.getByRole("button", { name: "Version history" });
  button.focus();
  fireEvent.click(button);
  const drawer = screen.getByRole("dialog", { name: "Version history" });
  // The fixture above is named document, so the page's document is window.document here.
  await waitFor(() => expect(drawer).toContainElement(window.document.activeElement as HTMLElement));
  fireEvent.keyDown(window.document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Version history" })).not.toBeInTheDocument());
  expect(button).toHaveFocus();
});

test("the inspector keeps the Graph help and no longer lists the versions", () => {
  renderEditor();
  const inspector = screen.getByRole("complementary", { name: "Inspector" });
  expect(inspector).toHaveTextContent("Select a node or an edge to edit it");
  expect(within(inspector).queryByText(/history/i)).not.toBeInTheDocument();
  expect(within(inspector).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  expect(within(inspector).queryByText("v4")).not.toBeInTheDocument();
});

const canvasNode = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)!;
const nodeCount = (container: HTMLElement) => container.querySelectorAll(".react-flow__node").length;

test("a locked graph cannot be added to, deleted from, connected or dragged", async () => {
  const { container } = renderEditor(twoNodes);
  fireEvent.click(screen.getByRole("button", { name: "Add Coder" }));
  expect(nodeCount(container)).toBe(2);
  expect(canvasNode(container, "planner")).not.toHaveClass("draggable");
  expect(container.querySelectorAll(".react-flow__handle.connectable, .react-flow__handle.connectablestart")).toHaveLength(0);
  fireEvent.click(canvasNode(container, "planner"));
  const inspector = screen.getByRole("complementary", { name: "Inspector" });
  expect(within(inspector).getByRole("button", { name: "Delete node" })).toBeDisabled();
  fireEvent.keyDown(window.document.body, { key: "Backspace" });
  fireEvent.keyDown(window.document.body, { key: "Delete" });
  // React Flow deletes after a promise; let it settle before checking nothing went.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(nodeCount(container)).toBe(2);
  expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
});

test("a locked graph still lets you select a node, edit its properties and save", async () => {
  vi.mocked(saveGraphAction).mockResolvedValue({ ok: true, version: 5 });
  const { container } = renderEditor();
  fireEvent.click(canvasNode(container, "planner"));
  fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Plan the work" } });
  fireEvent.click(screen.getByRole("button", { name: "Save as v5" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled());
  expect(saveGraphAction).toHaveBeenCalledWith(
    "p1",
    "plan-review",
    expect.objectContaining({ nodes: [expect.objectContaining({ key: "planner", attributes: expect.objectContaining({ label: "Plan the work" }) })] }),
  );
  expect(screen.getByRole("button", { name: "Unlock editing" })).toBeInTheDocument();
});

test("unlocking lets you add a node and delete the selected one", async () => {
  const { container } = renderEditor(twoNodes);
  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));
  expect(screen.getByRole("button", { name: "Lock editing" })).toBeInTheDocument();
  expect(canvasNode(container, "planner")).toHaveClass("draggable");
  fireEvent.click(screen.getByRole("button", { name: "Add Reviewer" }));
  expect(nodeCount(container)).toBe(3);
  fireEvent.click(canvasNode(container, "coder"));
  fireEvent.keyDown(window.document.body, { key: "Backspace" });
  // React Flow deletes the selection after a promise (its onBeforeDelete).
  await waitFor(() => expect(canvasNode(container, "coder")).toBeNull());
  fireEvent.click(canvasNode(container, "planner"));
  fireEvent.click(within(screen.getByRole("complementary", { name: "Inspector" })).getByRole("button", { name: "Delete node" }));
  expect(nodeCount(container)).toBe(1);
});

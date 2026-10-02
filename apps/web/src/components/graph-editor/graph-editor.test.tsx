import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { loadGraphVersionAction } from "@/app/projects/actions";
import { GraphEditor } from "./graph-editor";

vi.mock("@/app/projects/actions", () => ({ loadGraphVersionAction: vi.fn(), saveGraphAction: vi.fn() }));

const document = {
  attributes: { startNode: "planner" },
  nodes: [{ key: "planner", attributes: { type: "planner", label: "Planner", config: {} } }],
  edges: [],
};
const versions = [
  { version: 4, createdAt: "2026-09-30T10:00:00.000Z", createdBy: "dashboard" },
  { version: 3, createdAt: "2026-09-29T10:00:00.000Z", createdBy: "cli" },
];

const renderEditor = () =>
  render(
    <TooltipProvider>
      <GraphEditor
        projectId="p1"
        graphName="plan-review"
        version={3}
        document={document}
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
  fireEvent.click(screen.getByRole("button", { name: "Add Coder" }));
  // The new Coder is not connected yet, so the graph has an issue and cannot be saved until it is.
  expect(screen.getByRole("button", { name: "Save as v5" })).toBeDisabled();
  expect(screen.getByRole("toolbar", { name: "Graph" })).toHaveTextContent(/\d+ issues?/);
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

test("the inspector keeps the Graph help and no longer lists the versions", () => {
  renderEditor();
  const inspector = screen.getByRole("complementary", { name: "Inspector" });
  expect(inspector).toHaveTextContent("Select a node or an edge to edit it");
  expect(within(inspector).queryByText(/history/i)).not.toBeInTheDocument();
  expect(within(inspector).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  expect(within(inspector).queryByText("v4")).not.toBeInTheDocument();
});

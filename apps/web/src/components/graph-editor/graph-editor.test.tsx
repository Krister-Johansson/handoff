import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { expect, test, vi } from "vitest";
import { AssistantProvider, useAssistant } from "@/components/assistant/assistant-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AssistantPort } from "@/lib/assistant/port";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { loadGraphVersionAction, saveGraphAction } from "@/app/projects/actions";
import { GraphEditor } from "./graph-editor";

vi.mock("@/app/projects/actions", () => ({ loadGraphVersionAction: vi.fn(), saveGraphAction: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/projects/p1/graphs/plan-review",
}));

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

test("the graph's name is the page's heading, which where_am_i reports", async () => {
  renderEditor();
  expect(within(screen.getByRole("toolbar", { name: "Graph" })).getByRole("heading", { level: 1 })).toHaveTextContent(/^plan-review$/);
  const { runUiTool } = await import("@/lib/assistant/run-ui-tool");
  const where = await runUiTool({ name: "where_am_i", args: {} }, { push: vi.fn() });
  expect(JSON.parse(where.text)).toMatchObject({ heading: "plan-review" });
});

test("an unsaved edit offers to save as the version after the newest one", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Add Coder" }));
  // The new Coder is not connected yet, so the graph has an issue and cannot be saved until it is.
  expect(screen.getByRole("button", { name: "Save as v5" })).toBeDisabled();
  expect(screen.getByRole("toolbar", { name: "Graph" })).toHaveTextContent(/\d+ issues?/);
  // With nothing selected, the inspector still opens to list the issues.
  expect(within(screen.getByRole("complementary", { name: "Inspector" })).getByText("Issues")).toBeInTheDocument();
});

test("the editor opens locked: the controls offer to unlock and the palette is disabled", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: "Unlock editing" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add Coder" })).toHaveAttribute("aria-disabled", "true");
});

test("no strip above the canvas says when the shown version was saved; the toolbar has the version", () => {
  renderEditor();
  expect(screen.queryByText(/saved .+ by cli/)).not.toBeInTheDocument();
  expect(screen.getByRole("toolbar", { name: "Graph" })).toHaveTextContent("v3");
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
  await waitFor(() => expect(screen.getByText("Old planner")).toBeInTheDocument());
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

test("with nothing selected there is no inspector, locked or unlocked; selecting a node shows it", () => {
  const { container } = renderEditor();
  expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Select a node or an edge/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));
  expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Select a node or an edge/)).not.toBeInTheDocument();

  fireEvent.click(canvasNode(container, "planner"));
  const inspector = screen.getByRole("complementary", { name: "Inspector" });
  expect(within(inspector).getByLabelText("Label")).toHaveValue("Planner");
  expect(within(inspector).queryByText(/history/i)).not.toBeInTheDocument();
  expect(within(inspector).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
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

function Grab({ onPort }: { onPort: (port: AssistantPort) => void }) {
  const port = useAssistant();
  useEffect(() => {
    onPort(port);
  }, [onPort, port]);
  return null;
}

/**
 * The editor inside the assistant, with a turn running so the test can call the page's tools as the
 * model would: `call` emits a ui_call and resolves with the page's answer.
 */
async function withAssistant(graph: unknown = twoNodes) {
  const transport = new FakeAssistantTransport();
  let port: AssistantPort | undefined;
  const onPort = (p: AssistantPort) => (port = p);
  const view = render(
    <AssistantProvider transport={transport} available>
      <Grab onPort={onPort} />
      <TooltipProvider>
        <GraphEditor
          projectId="p1"
          graphName="plan-review"
          version={3}
          document={graph}
          library={{ skills: [], mcp: [], agents: [], groups: [] }}
          versions={versions}
        />
      </TooltipProvider>
    </AssistantProvider>,
  );
  act(() => void port!.send("what is on this page"));
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  let next = 1;
  const call = async (name: string, args: unknown = {}) => {
    const requestId = `u${next++}`;
    act(() => transport.emit({ type: "ui_call", requestId, name, args }));
    await waitFor(() => expect(transport.uiReplies.find((r) => r.requestId === requestId)).toBeDefined());
    const { text, isError } = transport.uiReplies.find((r) => r.requestId === requestId)!;
    return { text, isError };
  };
  const whereAmI = async () => JSON.parse((await call("where_am_i")).text) as { page?: { kind: string; tools: { name: string }[]; state: { data: Record<string, unknown> } } };
  return { ...view, call, whereAmI, transport };
}

const inspector = () => screen.getByRole("complementary", { name: "Inspector" });

test("page_select selects a node and the inspector shows it", async () => {
  const { call, container, whereAmI } = await withAssistant();
  expect(await call("page_select", { node: "coder" })).toEqual({ text: "Selected coder (Coder, coder).", isError: false });
  expect(within(inspector()).getByLabelText("Label")).toHaveValue("Coder");
  expect(within(inspector()).getByText("coder · runs on cli")).toBeInTheDocument();
  expect(canvasNode(container, "coder")).toHaveClass("selected");
  expect((await whereAmI()).page!.state.data).toMatchObject({ selection: { node: "coder" } });

  expect(await call("page_select", { edge: "planner->coder" })).toEqual({ text: "Selected edge planner->coder (planner to coder).", isError: false });
  expect(within(inspector()).queryByLabelText("Label")).not.toBeInTheDocument();
  expect(canvasNode(container, "coder")).not.toHaveClass("selected");

  expect(await call("page_select", { node: "tester" })).toEqual({ text: "There is no node tester. The nodes are: planner, coder.", isError: true });
  expect(await call("page_select", { edge: "coder->planner" })).toEqual({ text: "There is no edge coder->planner. The edges are: planner->coder.", isError: true });

  expect(await call("page_select", {})).toEqual({ text: "Cleared the selection.", isError: false });
  expect(screen.queryByRole("complementary", { name: "Inspector" })).not.toBeInTheDocument();
});

/** A Planner, a Coder with instructions, and a Reviewer that sends changes back to the Coder. */
const reviewed = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", label: "Planner", x: 0, y: 0, config: {} } },
    { key: "coder", attributes: { type: "coder", label: "Coder", x: 300, y: 0, config: { instructions: "Keep commits small.", maxTurns: 40 }, notify: { failed: false } } },
    { key: "reviewer", attributes: { type: "reviewer", label: "Review", x: 600, y: 0, config: {} } },
  ],
  edges: [
    { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done", input: "in" } },
    { key: "coder->reviewer", source: "coder", target: "reviewer", attributes: { port: "done", input: "in" } },
    { key: "reviewer->coder", source: "reviewer", target: "coder", attributes: { port: "changes", input: "feedback", loop: true, maxAttempts: 3 } },
  ],
};

test("page_get_node returns the node's label, type, config and edges", async () => {
  const { call } = await withAssistant(reviewed);
  const { text, isError } = await call("page_get_node", { key: "coder" });
  expect(isError).toBe(false);
  expect(JSON.parse(text)).toMatchObject({
    key: "coder",
    type: "coder",
    label: "Coder",
    isStart: false,
    config: { instructions: "Keep commits small.", maxTurns: 40 },
    notify: { failed: false },
    edges: {
      in: [
        { id: "planner->coder", from: "planner", port: "done", input: "in" },
        { id: "reviewer->coder", from: "reviewer", port: "changes", input: "feedback" },
      ],
      out: [{ id: "coder->reviewer", to: "reviewer", port: "done" }],
    },
    // What page_update_node takes for a coder.
    fields: ["label", "notify", "join", "instructions", "model", "effort", "maxTurns", "allTools", "allowedTools", "library", "checks"],
  });
  expect(await call("page_get_node", { key: "tester" })).toEqual({ text: "There is no node tester. The nodes are: planner, coder, reviewer.", isError: true });
});

test("page_update_node changes a coder's instructions and marks the graph unsaved, and an unknown key is refused with the known ones", async () => {
  const { call } = await withAssistant(reviewed);
  await call("page_select", { node: "coder" });
  expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

  expect(await call("page_update_node", { key: "coder", patch: { instructions: "Keep commits small and focused.", effort: "high" } })).toEqual({
    text: "Changed instructions, effort of coder. The graph is not saved yet.",
    isError: false,
  });
  // The inspector shows the new text even though the coder was already open in it.
  expect(within(inspector()).getByLabelText("Instructions")).toHaveValue("Keep commits small and focused.");
  expect(within(inspector()).getByLabelText("Effort")).toHaveValue("high");
  expect(screen.getByRole("button", { name: "Save as v5" })).toBeEnabled();

  // null clears a setting, as emptying its field does.
  expect(await call("page_update_node", { key: "coder", patch: { maxTurns: null } })).toMatchObject({ isError: false });
  expect(within(inspector()).getByLabelText("Max turns")).toHaveValue(null);

  expect(await call("page_update_node", { key: "coder", patch: { instructions: "Ship it.", temperature: 0.2 } })).toEqual({
    text: "A coder has no temperature. Its fields are: label, notify, join, instructions, model, effort, maxTurns, allTools, allowedTools, library, checks.",
    isError: true,
  });
  expect(await call("page_update_node", { key: "coder", patch: { effort: "huge" } })).toEqual({
    text: 'The change to coder is not valid: effort: Invalid option: expected one of "low"|"medium"|"high"|"xhigh"|"max"',
    isError: true,
  });
  expect(within(inspector()).getByLabelText("Instructions")).toHaveValue("Keep commits small and focused.");

  // Each node type has its own fields: a reviewer has no tests to run.
  expect(await call("page_update_node", { key: "reviewer", patch: { checks: [] } })).toMatchObject({ isError: true, text: expect.stringMatching(/^A reviewer has no checks\. Its fields are: label, notify, join, instructions/) });
});

/** A Planner that hands to a Coder, and a Reviewer and a Finish not connected yet. */
const unconnected = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", label: "Planner", x: 0, y: 0, config: {} } },
    { key: "coder", attributes: { type: "coder", label: "Coder", x: 300, y: 0, config: {} } },
    { key: "reviewer", attributes: { type: "reviewer", label: "Review", x: 600, y: 0, config: {} } },
    { key: "finish", attributes: { type: "finish", label: "Finish", x: 900, y: 0, config: {} } },
  ],
  edges: [{ key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done", input: "in" } }],
};

const edgesOf = async (whereAmI: () => Promise<{ page?: { state: { data: Record<string, unknown> } } }>) => (await whereAmI()).page!.state.data.edges;

test("page_connect adds an edge the rules allow and refuses one they do not", async () => {
  const { call, whereAmI } = await withAssistant(unconnected);
  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));

  expect(await call("page_connect", { source: "coder", target: "reviewer", port: "done" })).toEqual({ text: "Connected coder (done) to reviewer. The graph is not saved yet.", isError: false });
  // A reviewer's changes go back to the coder as feedback.
  expect(await call("page_connect", { source: "reviewer", target: "coder", port: "changes" })).toEqual({
    text: "Connected reviewer (changes) to coder, as feedback. The graph is not saved yet.",
    isError: false,
  });
  expect(await edgesOf(whereAmI)).toEqual([
    { id: "planner->coder", source: "planner", target: "coder", port: "done", loop: false },
    { id: "coder->reviewer", source: "coder", target: "reviewer", port: "done", loop: false },
    { id: "reviewer->coder", source: "reviewer", target: "coder", port: "changes", loop: false },
  ]);
  expect(screen.getByRole("button", { name: /^Save as v\d+$/ })).toBeInTheDocument();

  expect(await call("page_connect", { source: "reviewer", target: "finish" })).toEqual({ text: "reviewer has several outputs: approve, changes. Say which with port.", isError: true });
  expect(await call("page_connect", { source: "reviewer", target: "finish", port: "done" })).toEqual({ text: "reviewer has no output done. Its outputs are: approve, changes.", isError: true });
  expect(await call("page_connect", { source: "coder", target: "coder", port: "done" })).toEqual({ text: "A node cannot connect to itself.", isError: true });
  expect(await call("page_connect", { source: "finish", target: "planner" })).toEqual({ text: "finish has no outputs: a Finish ends the graph.", isError: true });
  expect(await call("page_connect", { source: "coder", target: "tester", port: "done" })).toEqual({ text: "There is no node tester. The nodes are: planner, coder, reviewer, finish.", isError: true });
  expect(await edgesOf(whereAmI)).toHaveLength(3);
});

test("page_remove removes nodes and their edges", async () => {
  const { call, container, whereAmI } = await withAssistant(reviewed);
  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));
  await call("page_select", { node: "reviewer" });

  expect(await call("page_remove", { ids: ["reviewer"] })).toEqual({ text: "Removed reviewer, and its edges coder->reviewer, reviewer->coder. The graph is not saved yet.", isError: false });
  expect(canvasNode(container, "reviewer")).toBeNull();
  expect(nodeCount(container)).toBe(2);
  expect(await edgesOf(whereAmI)).toEqual([{ id: "planner->coder", source: "planner", target: "coder", port: "done", loop: false }]);
  // The inspector let go of the removed node.
  expect(screen.queryByLabelText("Label")).not.toBeInTheDocument();

  expect(await call("page_remove", { ids: ["planner->coder"] })).toEqual({ text: "Removed planner->coder. The graph is not saved yet.", isError: false });
  expect(await edgesOf(whereAmI)).toEqual([]);

  expect(await call("page_remove", { ids: ["coder", "tester"] })).toEqual({ text: "There is no node or edge tester. The nodes are: planner, coder. The edges are: none.", isError: true });
  expect(nodeCount(container)).toBe(2);
});

test("while the graph is locked, page_connect, page_remove and page_add_node are refused, and selecting, reading, changing and saving still work", async () => {
  vi.mocked(saveGraphAction).mockReset().mockResolvedValue({ ok: true, version: 5 });
  const { call, container, whereAmI } = await withAssistant(reviewed);
  const locked = { text: "The graph is locked; unlock it to change its structure.", isError: true };
  expect((await whereAmI()).page!.state.data).toMatchObject({ locked: true });

  expect(await call("page_connect", { source: "reviewer", target: "planner", port: "approve" })).toEqual(locked);
  expect(await call("page_remove", { ids: ["reviewer"] })).toEqual(locked);
  expect(await call("page_add_node", { type: "tester" })).toEqual(locked);
  expect(nodeCount(container)).toBe(3);
  expect(await edgesOf(whereAmI)).toHaveLength(3);
  expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();

  expect(await call("page_select", { node: "coder" })).toMatchObject({ isError: false });
  expect(await call("page_get_node", { key: "coder" })).toMatchObject({ isError: false });
  expect(await call("page_update_node", { key: "coder", patch: { label: "Build it" } })).toMatchObject({ isError: false });
  expect(await call("page_save_graph")).toEqual({ text: "Saved plan-review as v5.", isError: false });
  // The tools leave the lock as it was.
  expect(screen.getByRole("button", { name: "Unlock editing" })).toBeInTheDocument();
});

test("page_add_node adds a node of a type once the graph is unlocked, at a position or in the middle of the view", async () => {
  const { call, container, whereAmI } = await withAssistant(reviewed);
  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));
  expect(await call("page_add_node", { type: "tester", position: { x: 900, y: 120 } })).toEqual({ text: "Added tester-1 (Tester). The graph is not saved yet.", isError: false });
  expect(canvasNode(container, "tester-1")).not.toBeNull();
  expect(await call("page_add_node", { type: "coder" })).toEqual({ text: "Added coder-2 (Coder). The graph is not saved yet.", isError: false });
  expect(nodeCount(container)).toBe(5);
  expect((await whereAmI()).page!.state.data.nodes).toContainEqual({ key: "tester-1", type: "tester", label: "Tester", isStart: false });
  // A graph has one Start, as the palette says.
  await call("page_add_node", { type: "start" });
  expect(await call("page_add_node", { type: "start" })).toEqual({ text: "The graph already has a Start node, start-1.", isError: true });
});

test("page_get_edge and page_update_edge read and change an edge, and page_rename_node renames a node and its edges follow", async () => {
  const { call, whereAmI } = await withAssistant(reviewed);
  expect(JSON.parse((await call("page_get_edge", { id: "reviewer->coder" })).text)).toMatchObject({
    id: "reviewer->coder",
    source: "reviewer",
    target: "coder",
    port: "changes",
    input: "feedback",
    loop: true,
    maxAttempts: 3,
    on: "passed",
  });

  await call("page_select", { edge: "reviewer->coder" });
  expect(await call("page_update_edge", { id: "reviewer->coder", patch: { maxAttempts: 5 } })).toEqual({ text: "Changed maxAttempts of edge reviewer->coder. The graph is not saved yet.", isError: false });
  expect(within(inspector()).getByLabelText("Max attempts")).toHaveValue(5);
  // Turning the loop off drops its attempts, as the inspector's switch does.
  await call("page_update_edge", { id: "reviewer->coder", patch: { loop: false } });
  expect(JSON.parse((await call("page_get_edge", { id: "reviewer->coder" })).text)).toMatchObject({ loop: false, maxAttempts: null });
  expect(await call("page_update_edge", { id: "reviewer->coder", patch: { weight: 2 } })).toEqual({
    text: "An edge has no weight. Its fields are: condition, on, loop, maxAttempts, onExhausted, priority.",
    isError: true,
  });
  expect(await call("page_update_edge", { id: "reviewer->coder", patch: { onExhausted: "coder" } })).toEqual({ text: "onExhausted names a human gate, and coder is not one. This graph has no human gate.", isError: true });

  expect(await call("page_rename_node", { key: "coder", to: "builder" })).toEqual({ text: "Renamed coder to builder. The graph is not saved yet.", isError: false });
  expect(await edgesOf(whereAmI)).toEqual([
    { id: "planner->builder", source: "planner", target: "builder", port: "done", loop: false },
    { id: "builder->reviewer", source: "builder", target: "reviewer", port: "done", loop: false },
    { id: "reviewer->builder", source: "reviewer", target: "builder", port: "changes", loop: false },
  ]);
  expect(await call("page_rename_node", { key: "builder", to: "planner" })).toEqual({ text: "There is already a node planner.", isError: true });
  expect(await call("page_rename_node", { key: "builder", to: "the coder" })).toEqual({ text: "A key has only letters, digits, - and _.", isError: true });
});

test("page_issues lists what keeps the graph from being saved, and page_tidy_layout lays the graph out again", async () => {
  const { call } = await withAssistant(unconnected);
  const issues = await call("page_issues");
  expect(issues.isError).toBe(false);
  expect(issues.text).toMatch(/^\d+ issues?: /);
  expect(issues.text).toContain("reviewer");
  expect(screen.getByRole("toolbar", { name: "Graph" })).toHaveTextContent(/\d+ issues?/);

  expect(await call("page_tidy_layout")).toEqual({ text: "Laid the graph out again. The graph is not saved yet.", isError: false });
  expect(screen.getByRole("button", { name: "Save as v5" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));
  await call("page_remove", { ids: ["reviewer", "finish"] });
  expect(await call("page_issues")).toEqual({ text: "The graph has no issues; it can be saved.", isError: false });
});

/** A Reviewer that both the Planner and the Coder lead to, with no join mode yet. */
const fannedIn = {
  attributes: { startNode: "planner" },
  nodes: [
    { key: "planner", attributes: { type: "planner", label: "Planner", x: 0, y: 0, config: {} } },
    { key: "coder", attributes: { type: "coder", label: "Coder", x: 300, y: 0, config: {} } },
    { key: "reviewer", attributes: { type: "reviewer", label: "Review", x: 600, y: 0, config: {} } },
  ],
  edges: [
    { key: "planner->coder", source: "planner", target: "coder", attributes: { port: "done", input: "in" } },
    { key: "planner->reviewer", source: "planner", target: "reviewer", attributes: { port: "done", input: "in" } },
    { key: "coder->reviewer", source: "coder", target: "reviewer", attributes: { port: "done", input: "in" } },
  ],
};

test("a node two edges reach without a join mode is an issue on it, and setting the mode clears it", async () => {
  const { call, container } = await withAssistant(fannedIn);
  const message = 'reviewer has 2 incoming edges; set its join mode to "all" (wait for every edge) or "any" (go on at the first)';
  expect(screen.getByRole("toolbar", { name: "Graph" })).toHaveTextContent("1 issue");
  expect(within(inspector()).getByText(message)).toBeInTheDocument();
  expect(within(canvasNode(container, "reviewer")).getByText("issue")).toHaveAttribute("title", message);

  await call("page_select", { node: "reviewer" });
  expect(within(inspector()).getByLabelText("Join")).toHaveValue("");
  expect(await call("page_update_node", { key: "reviewer", patch: { join: "any" } })).toMatchObject({ isError: false });
  expect(within(inspector()).getByLabelText("Join")).toHaveValue("any");
  expect(await call("page_issues")).toEqual({ text: "The graph has no issues; it can be saved.", isError: false });
});

test("page_save_graph is refused with the issues while the graph is invalid, and otherwise saves as the next version", async () => {
  vi.mocked(saveGraphAction).mockReset().mockResolvedValue({ ok: true, version: 5 });
  const { call } = await withAssistant(unconnected);
  // Nothing edited yet: there is nothing to save.
  expect(await call("page_save_graph")).toEqual({ text: "The graph has no unsaved changes; it is v3.", isError: true });

  await call("page_update_node", { key: "planner", patch: { label: "Plan the work" } });
  const refused = await call("page_save_graph");
  expect(refused.isError).toBe(true);
  expect(refused.text).toMatch(/^The graph has \d+ issues?, so it cannot be saved: /);
  expect(refused.text).toContain("reviewer");
  expect(saveGraphAction).not.toHaveBeenCalled();

  // The locked editor still saves: removing what does not fit makes the graph valid.
  fireEvent.click(screen.getByRole("button", { name: "Unlock editing" }));
  await call("page_remove", { ids: ["reviewer", "finish"] });
  fireEvent.click(screen.getByRole("button", { name: "Lock editing" }));
  expect(await call("page_save_graph")).toEqual({ text: "Saved plan-review as v5.", isError: false });
  expect(saveGraphAction).toHaveBeenCalledWith(
    "p1",
    "plan-review",
    expect.objectContaining({ nodes: [expect.objectContaining({ key: "planner", attributes: expect.objectContaining({ label: "Plan the work" }) }), expect.objectContaining({ key: "coder" })] }),
  );
  expect(screen.getByRole("button", { name: "Saved" })).toBeDisabled();
  expect(screen.getByRole("toolbar", { name: "Graph" })).toHaveTextContent("v5");

  // A save the server refuses says why.
  vi.mocked(saveGraphAction).mockResolvedValue({ ok: false, errors: [{ code: "invalid_document", message: "The graph changed on the server." }] });
  await call("page_update_node", { key: "planner", patch: { label: "Plan" } });
  expect(await call("page_save_graph")).toEqual({ text: "The graph was not saved: The graph changed on the server.", isError: true });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { McpToolsPanel } from "./mcp-tools";

const actions = vi.hoisted(() => ({ saveMcpToolsAction: vi.fn(), checkSavedMcpAction: vi.fn() }));
vi.mock("@/app/library/actions", () => actions);
beforeEach(() => {
  actions.saveMcpToolsAction.mockReset().mockResolvedValue({ ok: true });
  actions.checkSavedMcpAction.mockReset();
});

const check = {
  status: "ok" as const,
  checkedAt: "2026-09-30T10:00:00Z",
  durationMs: 400,
  server: { name: "Context7", version: "4.1.1" },
  resources: 0,
  prompts: 0,
  tools: [
    {
      name: "resolve-library-id",
      description: "Resolves a package name to a library ID.",
      inputSchema: { type: "object", properties: { libraryName: { type: "string", description: "Library to look up" } }, required: ["libraryName"] },
    },
    { name: "query-docs", description: "Fetches documentation." },
  ],
};

test("with every tool allowed all are ticked, and unticking one saves the rest", async () => {
  render(<McpToolsPanel name="context7" check={check} allowed={[]} />);
  expect(screen.getByRole("checkbox", { name: "resolve-library-id" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "query-docs" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Save allowed tools" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "resolve-library-id" }));
  fireEvent.click(screen.getByRole("button", { name: "Save allowed tools" }));
  await waitFor(() => expect(actions.saveMcpToolsAction).toHaveBeenCalledWith("context7", ["query-docs"]));
});

test("ticking every tool again saves an empty list, which allows every tool", async () => {
  render(<McpToolsPanel name="context7" check={check} allowed={["query-docs"]} />);
  expect(screen.getByRole("checkbox", { name: "resolve-library-id" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("checkbox", { name: "resolve-library-id" }));
  fireEvent.click(screen.getByRole("button", { name: "Save allowed tools" }));
  await waitFor(() => expect(actions.saveMcpToolsAction).toHaveBeenCalledWith("context7", []));
});

test("no ticked tool cannot be saved", () => {
  render(<McpToolsPanel name="context7" check={check} allowed={["query-docs"]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "query-docs" }));
  expect(screen.getByRole("button", { name: "Save allowed tools" })).toBeDisabled();
  expect(screen.getByText(/tick at least one tool/i)).toBeInTheDocument();
});

test("a tool's parameters are listed under it", () => {
  render(<McpToolsPanel name="context7" check={check} allowed={[]} />);
  fireEvent.click(screen.getAllByText("Parameters")[0]!);
  expect(screen.getByText("libraryName")).toBeInTheDocument();
  expect(screen.getByText("Library to look up")).toBeInTheDocument();
});

test("a server never checked can be checked from the tab, which lists its tools", async () => {
  actions.checkSavedMcpAction.mockResolvedValue({ check });
  render(<McpToolsPanel name="context7" check={null} allowed={[]} />);
  expect(screen.getByText(/check the server to list its tools/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Check server" }));
  await waitFor(() => expect(actions.checkSavedMcpAction).toHaveBeenCalledWith("context7"));
  expect(await screen.findByRole("checkbox", { name: "query-docs" })).toBeChecked();
});

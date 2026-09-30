import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { DefaultLibrary } from "./default-library";

const actions = vi.hoisted(() => ({ saveProjectLibraryAction: vi.fn() }));
vi.mock("@/app/projects/actions", () => actions);
beforeEach(() => actions.saveProjectLibraryAction.mockReset().mockResolvedValue({ ok: true }));

const available = {
  skills: [
    { name: "tdd", detail: "Test first", source: "mattpocock/skills" },
    { name: "grill-me", detail: "Interview the plan", source: "mattpocock/skills" },
    { name: "ci-triage", detail: "Read CI logs", source: "Written here" },
  ],
  mcp: [{ name: "context7", detail: "https://mcp.context7.com/mcp/oauth" }],
  agents: [],
  groups: [{ name: "testing", detail: "ci-triage, tdd" }],
};
const none = { skills: [], mcp: [], agents: [], groups: [] };

test("with no default, runs get only what each node enables", () => {
  render(<DefaultLibrary projectId="p1" available={available} initial={none} />);
  expect(screen.getByText(/only what each node enables/i)).toBeInTheDocument();
});

test("the dialog picks entries per kind with checkboxes and saves them as the default", async () => {
  render(<DefaultLibrary projectId="p1" available={available} initial={none} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose" }));
  const dialog = await screen.findByRole("dialog", { name: "Default library" });
  fireEvent.mouseDown(within(dialog).getByRole("tab", { name: /Skills/ }), { button: 0 });
  expect(within(dialog).getByText("mattpocock/skills")).toBeInTheDocument();
  expect(within(dialog).getByText("Written here")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "tdd" }));
  fireEvent.mouseDown(within(dialog).getByRole("tab", { name: /MCP servers/ }), { button: 0 });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "context7" }));
  expect(within(dialog).getByText("2 chosen")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.saveProjectLibraryAction).toHaveBeenCalledWith("p1", { skills: ["tdd"], mcp: ["context7"], agents: [], groups: [] }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("search narrows the list to matching names and descriptions", async () => {
  render(<DefaultLibrary projectId="p1" available={available} initial={none} />);
  fireEvent.click(screen.getByRole("button", { name: "Choose" }));
  const dialog = await screen.findByRole("dialog", { name: "Default library" });
  fireEvent.mouseDown(within(dialog).getByRole("tab", { name: /Skills/ }), { button: 0 });
  fireEvent.change(within(dialog).getByRole("searchbox", { name: "Search skills" }), { target: { value: "interview" } });
  expect(within(dialog).getByRole("checkbox", { name: "grill-me" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("checkbox", { name: "tdd" })).not.toBeInTheDocument();
});

test("removing a chosen entry from the card saves at once", async () => {
  render(<DefaultLibrary projectId="p1" available={available} initial={{ ...none, skills: ["tdd"], groups: ["testing"] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove skill tdd" }));
  await waitFor(() => expect(actions.saveProjectLibraryAction).toHaveBeenCalledWith("p1", { ...none, groups: ["testing"] }));
});

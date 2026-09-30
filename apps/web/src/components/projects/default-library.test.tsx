import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { DefaultLibrary } from "./default-library";

const actions = vi.hoisted(() => ({ saveProjectLibraryAction: vi.fn() }));
vi.mock("@/app/projects/actions", () => actions);
beforeEach(() => actions.saveProjectLibraryAction.mockReset().mockResolvedValue({ ok: true }));

const available = {
  skills: [
    { name: "tdd", detail: "Test first" },
    { name: "grill-me", detail: "Interview the plan" },
  ],
  mcp: [{ name: "context7", detail: "https://mcp.context7.com/mcp/oauth" }],
  agents: [],
  groups: [{ name: "testing", detail: "ci-triage, tdd" }],
};
const none = { skills: [], mcp: [], agents: [], groups: [] };

test("with no default, runs get only what each node enables", () => {
  render(<DefaultLibrary projectId="p1" available={available} initial={none} />);
  expect(screen.getByText(/only what each node enables/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save default library" })).toBeDisabled();
});

test("entries picked from the library are saved as the project's default", async () => {
  render(<DefaultLibrary projectId="p1" available={available} initial={none} />);
  fireEvent.click(screen.getByRole("combobox", { name: "Add from the library" }));
  fireEvent.click(await screen.findByRole("option", { name: /context7/ }));
  fireEvent.click(screen.getByRole("option", { name: /^tdd/ }));
  const chosen = screen.getByRole("list", { name: "Default library" });
  expect(within(chosen).getByText("context7")).toBeInTheDocument();
  expect(within(chosen).getByText("tdd")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save default library" }));
  await waitFor(() => expect(actions.saveProjectLibraryAction).toHaveBeenCalledWith("p1", { skills: ["tdd"], mcp: ["context7"], agents: [], groups: [] }));
});

test("a default entry can be removed", async () => {
  render(<DefaultLibrary projectId="p1" available={available} initial={{ ...none, skills: ["tdd"], groups: ["testing"] }} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove skill tdd" }));
  fireEvent.click(screen.getByRole("button", { name: "Save default library" }));
  await waitFor(() => expect(actions.saveProjectLibraryAction).toHaveBeenCalledWith("p1", { ...none, groups: ["testing"] }));
});

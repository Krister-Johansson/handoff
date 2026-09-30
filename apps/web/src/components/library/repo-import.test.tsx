import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { RepoImport } from "./repo-import";

const actions = vi.hoisted(() => ({ importRepoAction: vi.fn() }));
vi.mock("@/app/library/repo-import-actions", () => actions);

test("importing a repository suggests a group name and reports each skill", async () => {
  actions.importRepoAction.mockResolvedValue({
    report: {
      repo: "anthropics/skills",
      group: "anthropics-skills",
      skills: [
        { name: "pdf", path: "skills/pdf", status: "imported", version: 1 },
        { name: "tdd", path: "skills/tdd", status: "skipped", reason: "the library already has a skill named tdd" },
      ],
    },
  });
  render(<RepoImport />);
  fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "anthropics/skills" } });
  expect(screen.getByLabelText("Group")).toHaveAttribute("placeholder", "anthropics-skills");
  fireEvent.click(screen.getByRole("button", { name: "Import repository" }));
  await waitFor(() => expect(actions.importRepoAction).toHaveBeenCalled());
  expect(Object.fromEntries((actions.importRepoAction.mock.calls[0] as unknown[])[1] as FormData)).toEqual({ repo: "anthropics/skills", group: "" });
  expect(await screen.findByRole("link", { name: "anthropics-skills" })).toHaveAttribute("href", "/library/groups/anthropics-skills");
  expect(screen.getByText("1 imported, 1 skipped")).toBeInTheDocument();
  expect(screen.getByText(/already has a skill named tdd/)).toBeInTheDocument();
});

test("a failed import shows why", async () => {
  actions.importRepoAction.mockResolvedValue({ error: "anthropics/nope has no SKILL.md files" });
  render(<RepoImport />);
  fireEvent.change(screen.getByLabelText("Repository"), { target: { value: "anthropics/nope" } });
  fireEvent.click(screen.getByRole("button", { name: "Import repository" }));
  expect(await screen.findByText(/has no SKILL.md files/)).toBeInTheDocument();
});

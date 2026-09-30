import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SkillsShRepoPicker } from "./skills-sh-repo-picker";

const actions = vi.hoisted(() => ({ syncRepoAction: vi.fn(async () => ({ report: { repo: "mattpocock/skills", group: "mattpocock-skills", added: ["grill-me"], removed: ["tdd"], failed: [] } })) }));
vi.mock("@/app/library/skills-sh-actions", () => actions);

const skills = [
  { id: "mattpocock/skills/grill-me", skillId: "grill-me", installs: 1_300_000 },
  { id: "mattpocock/skills/tdd", skillId: "tdd", installs: 990_800 },
  { id: "mattpocock/skills/wizard", skillId: "wizard", installs: 12 },
];

test("skills in the library start ticked; ticking and unticking says what Apply will do and sends the ticked ones", async () => {
  render(<SkillsShRepoPicker repo="mattpocock/skills" skills={skills} installed={["tdd"]} />);
  expect(screen.getByRole("checkbox", { name: "tdd" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "grill-me" })).not.toBeChecked();
  expect(screen.getByRole("button", { name: /Apply/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "grill-me" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "tdd" }));
  expect(screen.getByText("Add 1, remove 1")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
  await waitFor(() => expect(actions.syncRepoAction).toHaveBeenCalled());
  const form = (actions.syncRepoAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("repo")).toBe("mattpocock/skills");
  expect(form.getAll("want")).toEqual(["grill-me"]);
  expect(await screen.findByText(/Added grill-me/)).toBeInTheDocument();
  expect(screen.getByText(/Removed tdd/)).toBeInTheDocument();
});

test("Select all ticks every skill", () => {
  render(<SkillsShRepoPicker repo="mattpocock/skills" skills={skills} installed={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("Add 3, remove 0")).toBeInTheDocument();
});

test("after Apply the ticks stay, and follow the library when the page brings the new state", async () => {
  const { rerender } = render(<SkillsShRepoPicker repo="mattpocock/skills" skills={skills} installed={["tdd"]} />);
  fireEvent.click(screen.getByRole("checkbox", { name: "grill-me" }));
  fireEvent.click(screen.getByRole("button", { name: /Apply/ }));
  expect(await screen.findByText(/Added grill-me/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "grill-me" })).toBeChecked();
  rerender(<SkillsShRepoPicker repo="mattpocock/skills" skills={skills} installed={["grill-me", "tdd"]} />);
  expect(screen.getByText("Add 0, remove 0")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "grill-me" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "tdd" })).toBeChecked();
});

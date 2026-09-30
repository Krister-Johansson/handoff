import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SkillsShDetails } from "./skills-sh-details";
import { SkillsShRepoPicker } from "./skills-sh-repo-picker";

const details = {
  summary: "Test-driven development with vertical slices.",
  points: ["Tests verify behavior through public APIs"],
  installs: 990_500,
  repository: "mattpocock/skills",
  githubStars: 272_000,
  firstSeen: "Feb 10, 2026",
  audits: [
    { name: "Socket", result: "Pass" },
    { name: "Snyk", result: "Warn" },
  ],
};

const actions = vi.hoisted(() => ({ syncRepoAction: vi.fn(), skillDetailsAction: vi.fn() }));
vi.mock("@/app/library/skills-sh-actions", () => actions);

test("details show what the skill does, its reach and its security audits", () => {
  render(<SkillsShDetails details={details} />);
  expect(screen.getByText("Test-driven development with vertical slices.")).toBeInTheDocument();
  expect(screen.getByText("Tests verify behavior through public APIs")).toBeInTheDocument();
  expect(screen.getByText("990.5K")).toBeInTheDocument();
  expect(screen.getByText("272K")).toBeInTheDocument();
  expect(screen.getByText("Feb 10, 2026")).toBeInTheDocument();
  expect(screen.getByText("Socket").closest("li")).toHaveTextContent("Pass");
  expect(screen.getByText("Snyk").closest("li")).toHaveTextContent("Warn");
});

test("a skill in a repository's list can be expanded to its details", async () => {
  actions.skillDetailsAction.mockResolvedValue({ details });
  render(<SkillsShRepoPicker repo="mattpocock/skills" skills={[{ id: "mattpocock/skills/tdd", skillId: "tdd", installs: 990_500 }]} installed={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Details of tdd" }));
  await waitFor(() => expect(actions.skillDetailsAction).toHaveBeenCalledWith("mattpocock/skills/tdd"));
  expect(await screen.findByText("Test-driven development with vertical slices.")).toBeInTheDocument();
});

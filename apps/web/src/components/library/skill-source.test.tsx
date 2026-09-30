import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SkillSource } from "./skill-source";

vi.mock("@/app/library/skills-sh-actions", () => ({ importSkillAction: vi.fn() }));

test("a skill from skills.sh links to skills.sh and can be checked for an update", () => {
  render(<SkillSource source={{ registry: "skills.sh", id: "mattpocock/skills/tdd" }} />);
  expect(screen.getByRole("link", { name: "skills.sh/mattpocock/skills/tdd" })).toHaveAttribute("href", "https://skills.sh/mattpocock/skills/tdd");
  expect(screen.getByRole("button", { name: "Check for update" })).toBeInTheDocument();
});

test("a skill from a GitHub repository links to its folder there", () => {
  render(<SkillSource source={{ registry: "github", id: "anthropics/skills/skills/pdf" }} />);
  expect(screen.getByRole("link", { name: "github.com/anthropics/skills/skills/pdf" })).toHaveAttribute("href", "https://github.com/anthropics/skills/tree/HEAD/skills/pdf");
  expect(screen.queryByRole("button", { name: "Check for update" })).not.toBeInTheDocument();
});

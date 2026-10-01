import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SkillsShBrowser } from "./skills-sh-browser";

const actions = vi.hoisted(() => ({
  searchSkillsShAction: vi.fn(),
  importSkillAction: vi.fn(async () => ({})),
}));
vi.mock("@/app/library/skills-sh-actions", () => actions);

test("searching lists skills with their repository and installs, and marks the ones already in the library", async () => {
  actions.searchSkillsShAction.mockResolvedValue({
    results: [
      { id: "mattpocock/skills/tdd", source: "mattpocock/skills", skillId: "tdd", name: "tdd", installs: 988340, inLibrary: "tdd" },
      { id: "affaan-m/ecc/tdd-workflow", source: "affaan-m/ecc", skillId: "tdd-workflow", name: "tdd-workflow", installs: 11434, inLibrary: null },
    ],
  });
  render(<SkillsShBrowser />);
  fireEvent.change(screen.getByLabelText("Search skills.sh"), { target: { value: "tdd" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(actions.searchSkillsShAction).toHaveBeenCalledWith("tdd"));
  const rows = await screen.findAllByRole("listitem");
  expect(screen.getByText("2 results for")).toBeInTheDocument();
  expect(screen.getByText("2 results for").nextSibling).toHaveTextContent("tdd");
  expect(within(rows[0]!).getByText("mattpocock/skills")).toBeInTheDocument();
  expect(within(rows[0]!).getByText("988K installs")).toBeInTheDocument();
  expect(within(rows[0]!).getByRole("link", { name: "In library" })).toHaveAttribute("href", "/library/skills/tdd");
  fireEvent.click(within(rows[1]!).getByRole("button", { name: "Import tdd-workflow" }));
  await waitFor(() => expect(actions.importSkillAction).toHaveBeenCalledTimes(1));
  expect(((actions.importSkillAction.mock.calls[0] as unknown[])[1] as FormData).get("id")).toBe("affaan-m/ecc/tdd-workflow");
});

test("a failed search shows why", async () => {
  actions.searchSkillsShAction.mockResolvedValue({ error: "skills.sh answered 503" });
  render(<SkillsShBrowser />);
  fireEvent.change(screen.getByLabelText("Search skills.sh"), { target: { value: "x" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(await screen.findByText(/skills.sh answered 503/)).toBeInTheDocument();
});

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { GroupEntries } from "./group-entries";

test("a group shows its first entries with their kind, and how many more it has", () => {
  render(<GroupEntries skills={["vercel-react-best-practices", "shadcn"]} mcp={["context7", "github"]} agents={["explorer"]} />);
  const chips = screen.getAllByRole("listitem");
  expect(chips.map((c) => c.textContent)).toEqual(["skillvercel-react-best-practices", "skillshadcn", "MCPcontext7", "+2"]);
  expect(screen.getByText("+2")).toHaveAttribute("title", "github, explorer");
});

test("a small group shows every entry", () => {
  render(<GroupEntries skills={["tdd"]} mcp={[]} agents={["test-writer"]} />);
  expect(screen.getAllByRole("listitem").map((c) => c.textContent)).toEqual(["skilltdd", "agenttest-writer"]);
});

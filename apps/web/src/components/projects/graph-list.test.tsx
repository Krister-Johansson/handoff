import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { GraphList } from "./graph-list";

vi.mock("@/app/projects/actions", () => ({
  createGraphAction: vi.fn(),
  startRunAction: vi.fn(),
  listIssuesAction: vi.fn(),
  deleteGraphAction: vi.fn(),
  renameGraphAction: vi.fn(),
}));

const now = new Date("2026-10-01T12:00:00Z");
const graphs = [
  { id: "g1", name: "master", latestVersion: 11, savedAt: new Date("2026-10-01T11:55:00Z"), runs: 3 },
  { id: "g2", name: "quick", latestVersion: 1, savedAt: new Date("2026-09-28T12:00:00Z"), runs: 0 },
];

test("each graph opens in the editor and says its version, when it was saved and how many runs used it", () => {
  render(<GraphList projectId="p1" graphs={graphs} defaultGraph="master" now={now} />);
  const master = screen.getByRole("row", { name: /master/ });
  expect(within(master).getByRole("link", { name: "master" })).toHaveAttribute("href", "/projects/p1/graphs/master");
  expect(master).toHaveTextContent("v11");
  expect(master).toHaveTextContent("default");
  expect(master).toHaveTextContent("saved 5 minutes ago");
  expect(master).toHaveTextContent("3 runs");
  const quick = screen.getByRole("row", { name: /quick/ });
  expect(quick).not.toHaveTextContent("default");
  expect(quick).toHaveTextContent("no runs");
  expect(within(quick).getByRole("button", { name: "Settings for quick" })).toBeInTheDocument();
});

test("without graphs the list says how to make one", () => {
  render(<GraphList projectId="p1" graphs={[]} defaultGraph={undefined} now={now} />);
  expect(screen.getByText("No graphs yet")).toBeInTheDocument();
});

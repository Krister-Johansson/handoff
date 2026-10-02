import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import ProjectSettingsPage from "./page";

const project = {
  id: "p1",
  name: "handoff",
  repoOwner: "octo",
  repoName: "handoff",
  defaultBranch: "main",
  setupCommand: "pnpm install",
  isDemo: false,
  planProjectNumber: 5,
  library: { skills: ["tdd"], mcp: [], agents: [], groups: [] },
};

vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/server/library-choices", () => ({ libraryChoices: async () => ({ skills: [{ name: "tdd", detail: "Test first", source: "Written here" }], mcp: [], agents: [], groups: [] }) }));
vi.mock("@/server/project-page", () => ({
  projectPage: async () => ({ project, graphs: [{ name: "plan-review", latestVersion: 11 }], runs: [{ id: "r1" }], defaultGraph: "plan-review" }),
  sectionCrumbs: (_: unknown, label: string) => [{ label }],
}));
vi.mock("@/app/projects/actions", () => ({ saveProjectLibraryAction: vi.fn() }));

test("project settings shows only the default graph and library", async () => {
  render(await ProjectSettingsPage({ params: Promise.resolve({ projectId: "p1" }) }));

  expect(screen.getByRole("heading", { name: "Default graph" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "plan-review" })).toHaveAttribute("href", "/projects/p1/graphs/plan-review");
  expect(screen.getByText(/the graph the latest run used/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Default library" })).toBeInTheDocument();

  // Repository, branch, setup command and the plan link are managed in Settings, Projects.
  for (const managedElsewhere of ["Repository", "Default branch", "Setup command", "pnpm install"]) expect(screen.queryByText(managedElsewhere)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Settings, Projects" })).toHaveAttribute("href", "/settings?tab=projects");
});

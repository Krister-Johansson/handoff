import { render, screen, within } from "@testing-library/react";
import { cardOf } from "@/components/scheduler/testing/fixtures";
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
vi.mock("@/app/projects/actions", () => ({ saveProjectLibraryAction: vi.fn(), listGitHubProjectsAction: vi.fn(), setupPlanAction: vi.fn() }));
vi.mock("@/app/projects/scheduler-actions", () => ({}));
const getProject = vi.hoisted(() => vi.fn(async () => ({ number: 5, priorityOptions: ["High", "Low"] })));
vi.mock("@/lib/github", () => ({ getProjects: () => ({ getProject }) }));
const loadSchedulerCard = vi.hoisted(() => vi.fn(async () => cardOf()));
vi.mock("@/server/scheduler-card", () => ({ loadSchedulerCard }));

test("project settings shows the default graph, the library and the scheduler", async () => {
  render(await ProjectSettingsPage({ params: Promise.resolve({ projectId: "p1" }) }));

  expect(screen.getByRole("heading", { name: "Default graph" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "plan-review" })).toHaveAttribute("href", "/projects/p1/graphs/plan-review");
  expect(screen.getByText(/the graph the latest run used/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Default library" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Scheduler" })).toBeInTheDocument();

  // Repository, branch, setup command and the plan link are managed in Settings, Projects.
  for (const managedElsewhere of ["Repository", "Default branch", "Setup command", "pnpm install"]) expect(screen.queryByText(managedElsewhere)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Settings, Projects" })).toHaveAttribute("href", "/settings?tab=projects");
});

test("the Scheduler section lists the project's graphs and knows whether its GitHub Project has a Priority field", async () => {
  render(await ProjectSettingsPage({ params: Promise.resolve({ projectId: "p1" }) }));
  const section = screen.getByRole("region", { name: "Scheduler" });
  expect(getProject).toHaveBeenCalledWith("octo", 5);
  expect(loadSchedulerCard).toHaveBeenCalledWith(expect.anything(), "p1");
  expect(within(section).getAllByRole("option").map((o) => o.textContent)).toEqual(["plan-review"]);
  expect(within(section).getByRole("radio", { name: "Priority" })).toBeEnabled();

  // GitHub out of reach: Priority stays off, the rest of the section works.
  getProject.mockRejectedValueOnce(new Error("GitHub did not answer"));
  render(await ProjectSettingsPage({ params: Promise.resolve({ projectId: "p1" }) }));
  expect(within(screen.getAllByRole("region", { name: "Scheduler" })[1]!).getByRole("radio", { name: "Priority" })).toBeDisabled();
});

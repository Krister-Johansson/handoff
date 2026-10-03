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
const projectPage = vi.hoisted(() => vi.fn());
vi.mock("@/server/project-page", () => ({
  projectPage,
  sectionCrumbs: (_: unknown, label: string) => [{ label }],
}));
const listProjectGraphs = vi.hoisted(() =>
  vi.fn(async () => [
    { id: "g1", name: "plan-review", latestVersion: 11, savedAt: new Date("2026-10-01T11:00:00Z"), runs: 41 },
    { id: "g2", name: "docs", latestVersion: 1, savedAt: new Date("2026-10-01T10:00:00Z"), runs: 0 },
  ]),
);
vi.mock("@/server/graphs", () => ({ listProjectGraphs, TEMPLATES: { loop: { label: "Plan, code, review" } } }));
vi.mock("@/app/projects/actions", () => ({
  saveProjectLibraryAction: vi.fn(),
  listGitHubProjectsAction: vi.fn(),
  setupPlanAction: vi.fn(),
  createGraphAction: vi.fn(),
  startRunAction: vi.fn(),
  listIssuesAction: vi.fn(),
  deleteGraphAction: vi.fn(),
  renameGraphAction: vi.fn(),
  setCapacityAction: vi.fn(),
  setPlanBudgetAction: vi.fn(),
}));
const forecastsForSettings = vi.hoisted(() =>
  vi.fn(async () => ({
    capacity: 8,
    forecasts: {
      S: { size: "S", source: "default", minutes: 30, parts: null, costUsd: null, runs: 0, measuredMinutes: null },
      M: { size: "M", source: "runs", minutes: 50, parts: { agent: 30, queue: 5, waiting: 15 }, costUsd: 0.9, runs: 12, measuredMinutes: 50 },
      L: { size: "L", source: "default", minutes: 120, parts: null, costUsd: null, runs: 0, measuredMinutes: null },
    },
  })),
);
vi.mock("@/server/forecasts", () => ({ forecastsForSettings }));
vi.mock("@/app/projects/scheduler-actions", () => ({}));
const getProject = vi.hoisted(() => vi.fn(async () => ({ number: 5, priorityOptions: ["High", "Low"] })));
vi.mock("@/lib/github", () => ({ getProjects: () => ({ getProject }) }));
const loadSchedulerCard = vi.hoisted(() => vi.fn(async () => cardOf()));
vi.mock("@/server/scheduler-card", () => ({ loadSchedulerCard }));

projectPage.mockImplementation(async () => ({ project, graphs: [{ name: "plan-review", latestVersion: 11 }, { name: "docs", latestVersion: 1 }], runs: [{ id: "r1" }], defaultGraph: "plan-review" }));

const open = async (tab?: string, p = project) => {
  projectPage.mockImplementationOnce(async () => ({ project: p, graphs: [{ name: "plan-review", latestVersion: 11 }], runs: [{ id: "r1" }], defaultGraph: "plan-review" }));
  render(await ProjectSettingsPage({ params: Promise.resolve({ projectId: "p1" }), searchParams: Promise.resolve(tab ? { tab } : {}) }));
};

test("project settings opens on Graphs: the list marks the default, opens each graph in the editor and starts new ones", async () => {
  await open();
  const nav = screen.getByRole("navigation", { name: "Project settings sections" });
  expect(within(nav).getByRole("link", { name: "Graphs" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { name: "Graphs" })).toBeInTheDocument();
  expect(screen.getByText(/New runs use the default graph unless you pick another/)).toBeInTheDocument();
  const row = screen.getByRole("row", { name: /plan-review/ });
  expect(within(row).getByRole("link", { name: "plan-review" })).toHaveAttribute("href", "/projects/p1/graphs/plan-review");
  expect(row).toHaveTextContent("default");
  expect(screen.getByRole("button", { name: "New graph" })).toBeInTheDocument();
  expect(listProjectGraphs).toHaveBeenCalledWith(expect.anything(), "p1");

  // The Graphs list marks the default, so there is no Default graph card; one section shows at a time.
  expect(screen.queryByRole("heading", { name: "Default graph" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Default library" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Scheduler" })).not.toBeInTheDocument();
});

test("the header says where the repository and its plan are managed", async () => {
  await open();
  expect(screen.getByText(/What runs of handoff start from and how its plan works/)).toBeInTheDocument();
  for (const managedElsewhere of ["Repository", "Default branch", "Setup command", "pnpm install"]) expect(screen.queryByText(managedElsewhere)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Settings, Projects" })).toHaveAttribute("href", "/settings?tab=projects");
});

test("?tab=library shows the Default library", async () => {
  await open("library");
  expect(screen.getByRole("heading", { name: "Default library" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Default library" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("heading", { name: "Graphs" })).not.toBeInTheDocument();
});

test("the Scheduler section lists the project's graphs and knows whether its GitHub Project has a Priority field", async () => {
  await open("scheduler");
  const section = screen.getByRole("region", { name: "Scheduler" });
  expect(getProject).toHaveBeenCalledWith("octo", 5);
  expect(loadSchedulerCard).toHaveBeenCalledWith(expect.anything(), "p1");
  expect(within(section).getAllByRole("option").map((o) => o.textContent)).toEqual(["plan-review"]);
  expect(within(section).getByRole("radio", { name: "Priority" })).toBeEnabled();

  // GitHub out of reach: Priority stays off, the rest of the section works.
  getProject.mockRejectedValueOnce(new Error("GitHub did not answer"));
  await open("scheduler");
  expect(within(screen.getAllByRole("region", { name: "Scheduler" })[1]!).getByRole("radio", { name: "Priority" })).toBeDisabled();
});

test("a demo project has no scheduler; its Scheduler section says so", async () => {
  await open("scheduler", { ...project, isDemo: true });
  expect(screen.queryByRole("region", { name: "Scheduler" })).not.toBeInTheDocument();
  expect(screen.getByText("The demo project has no scheduler.")).toBeInTheDocument();
});

test("?tab=estimates shows the capacity, the forecasts from this project's runs and the plan budget", async () => {
  await open("estimates", { ...project, planBudget: { files: 8, steps: 6 } } as typeof project);
  expect(screen.getByRole("link", { name: "Estimates" })).toHaveAttribute("aria-current", "page");
  expect(forecastsForSettings).toHaveBeenCalledWith(expect.anything(), "p1", expect.objectContaining({ getProject }));
  expect(screen.getByRole("region", { name: "Capacity" })).toHaveTextContent("8h a day");
  expect(within(screen.getByRole("region", { name: "Forecasts from finished runs" })).getByRole("row", { name: /^M/ })).toHaveTextContent("$0.90");
  expect(within(screen.getByRole("region", { name: "Plan budget" })).getByLabelText("Files")).toHaveValue(8);
  expect(screen.queryByRole("heading", { name: "Scheduler" })).not.toBeInTheDocument();
});

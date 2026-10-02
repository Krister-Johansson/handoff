import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { QUIET } from "@/components/overview/testing/overview-fixtures";
import { cardOf, OFF } from "@/components/scheduler/testing/fixtures";
import ProjectPage from "./page";

const project = { id: "p1", name: "handoff", repoOwner: "Krister-Johansson", repoName: "handoff", defaultBranch: "main", isDemo: false, planProjectNumber: 5 };

const loadOverview = vi.hoisted(() => vi.fn());
const loadSchedulerCard = vi.hoisted(() => vi.fn());
vi.mock("@/server/scheduler-card", () => ({ loadSchedulerCard }));
vi.mock("@/app/projects/scheduler-actions", () => ({ turnOnSchedulerAction: vi.fn(), pauseSchedulerAction: vi.fn(), resumeSchedulerAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn(), usePathname: () => "/projects/p1" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/github", () => ({ getGitHub: () => undefined, getProjects: () => undefined }));
vi.mock("@/server/overview", () => ({ loadOverview }));
vi.mock("@/server/project-page", () => ({
  projectPage: async () => ({ project, graphs: [{ name: "plan-review", latestVersion: 11 }], runs: [], defaultGraph: "plan-review" }),
  repoUrl: (p: { repoOwner: string; repoName: string }) => `https://github.com/${p.repoOwner}/${p.repoName}`,
  sectionCrumbs: (_: unknown, label: string) => [{ label }],
}));
vi.mock("@/app/inbox/actions", () => ({ answerAction: vi.fn(), repairAction: vi.fn(), cancelAction: vi.fn(), resolveLoopAction: vi.fn(), answerPermissionAction: vi.fn() }));
vi.mock("@/app/projects/actions", () => ({ requestMergeAction: vi.fn(), startRunAction: vi.fn(), listIssuesAction: vi.fn(), listGitHubProjectsAction: vi.fn(), setupPlanAction: vi.fn() }));

test("the project's own address shows its Home page: the repository, the plan on GitHub, New run and the sections in order", async () => {
  loadOverview.mockResolvedValue(QUIET);
  loadSchedulerCard.mockResolvedValue(OFF);
  render(await ProjectPage({ params: Promise.resolve({ projectId: "p1" }), searchParams: Promise.resolve({}) }));

  expect(loadOverview).toHaveBeenCalledWith(expect.anything(), undefined, undefined, "p1");
  expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Krister-Johansson/handoff" })).toHaveAttribute("href", "https://github.com/Krister-Johansson/handoff");
  expect(screen.getByRole("link", { name: "handoff plan" })).toHaveAttribute("href", "https://github.com/users/Krister-Johansson/projects/5");
  expect(screen.getByRole("button", { name: "New run" })).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Needs you", "Running now", "Finished in the last day", "Features in progress", "Ready to start"]);
});

test("Home shows the scheduler as one line once it has been turned on, and nothing while it is off", async () => {
  loadOverview.mockResolvedValue(QUIET);
  loadSchedulerCard.mockResolvedValue(cardOf({ status: { state: "idle", idle: { reason: "no_ready", text: "No task is Ready. Move shaped tasks to Ready on the Plan." } } }));
  const { unmount } = render(await ProjectPage({ params: Promise.resolve({ projectId: "p1" }), searchParams: Promise.resolve({}) }));
  expect(loadSchedulerCard).toHaveBeenCalledWith(expect.anything(), "p1");
  expect(screen.getByRole("region", { name: "Scheduler of handoff" })).toHaveTextContent("No task is Ready. Move shaped tasks to Ready on the Plan.");
  unmount();

  loadSchedulerCard.mockResolvedValue(OFF);
  render(await ProjectPage({ params: Promise.resolve({ projectId: "p1" }), searchParams: Promise.resolve({}) }));
  expect(screen.queryByRole("region", { name: "Scheduler of handoff" })).not.toBeInTheDocument();
});

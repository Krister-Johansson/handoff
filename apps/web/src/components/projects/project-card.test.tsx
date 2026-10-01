import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { DeleteProjectDialog, EditProjectDialog, ProjectCard } from "./project-card";

const actions = vi.hoisted(() => ({
  updateProjectAction: vi.fn(async () => ({ ok: true })),
  deleteProjectAction: vi.fn(async () => ({ ok: false, error: "The project has 1 active run. Cancel it first." })),
}));
vi.mock("@/app/projects/actions", () => actions);

beforeEach(() => {
  actions.updateProjectAction.mockClear();
  actions.deleteProjectAction.mockClear();
});

const project = { id: "p1", name: "sandbox", repoOwner: "octo", repoName: "sample", defaultBranch: "main", isDemo: false, runCount: 8 };
const calm = { questions: 0, failed: 0, reviews: 0, waitingOnCi: 0, running: 0 };

test("a project that needs nothing shows its repository and run count, and no call for attention", () => {
  render(<ProjectCard project={project} attention={calm} />);
  expect(screen.getByRole("link", { name: "sandbox" })).toHaveAttribute("href", "/projects/p1");
  expect(screen.getByText("octo/sample · main")).toBeInTheDocument();
  expect(screen.getByText("8 runs")).toBeInTheDocument();
  expect(screen.queryByText("Needs you")).not.toBeInTheDocument();
});

test("questions, failed runs and pull requests to review call for attention, each linking to where to act", () => {
  render(<ProjectCard project={project} attention={{ ...calm, questions: 2, failed: 1, reviews: 1 }} />);
  expect(screen.getByText("Needs you")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "2 questions" })).toHaveAttribute("href", "/inbox");
  expect(screen.getByRole("link", { name: "1 failed run" })).toHaveAttribute("href", "/inbox");
  expect(screen.getByRole("link", { name: "1 PR to review" })).toHaveAttribute("href", "/projects/p1?tab=pulls");
});

test("running work and pull requests waiting on CI show as quiet status", () => {
  render(<ProjectCard project={project} attention={{ ...calm, running: 2, waitingOnCi: 1 }} />);
  expect(screen.getByText("2 running")).toBeInTheDocument();
  expect(screen.getByText("1 waiting on CI")).toBeInTheDocument();
  expect(screen.queryByText("Needs you")).not.toBeInTheDocument();
});

test("editing submits the new name, default branch and setup command", async () => {
  render(<EditProjectDialog project={project} open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
  fireEvent.change(screen.getByLabelText("Default branch"), { target: { value: "trunk" } });
  fireEvent.change(screen.getByLabelText("Setup command"), { target: { value: "pnpm install --frozen-lockfile" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.updateProjectAction).toHaveBeenCalledTimes(1));
  const form = (actions.updateProjectAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(Object.fromEntries(form)).toEqual({ projectId: "p1", name: "renamed", defaultBranch: "trunk", setupCommand: "pnpm install --frozen-lockfile" });
});

test("deleting asks first, says what goes, and shows a refusal", async () => {
  render(<DeleteProjectDialog project={project} open onOpenChange={() => {}} />);
  expect(screen.getByText(/8 runs/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
  await waitFor(() => expect(actions.deleteProjectAction).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("The project has 1 active run. Cancel it first.")).toBeInTheDocument();
});

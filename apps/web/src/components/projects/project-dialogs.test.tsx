import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { DeleteProjectDialog, EditProjectDialog } from "./project-dialogs";

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

test("editing submits the new name, default branch and setup command", async () => {
  render(<EditProjectDialog project={project} open onOpenChange={() => {}} />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "renamed" } });
  fireEvent.change(screen.getByLabelText("Default branch"), { target: { value: "trunk" } });
  fireEvent.change(screen.getByLabelText("Setup command"), { target: { value: "pnpm install --frozen-lockfile" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.updateProjectAction).toHaveBeenCalledTimes(1));
  const form = (actions.updateProjectAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(Object.fromEntries(form)).toEqual({ projectId: "p1", name: "renamed", defaultBranch: "trunk", setupCommand: "pnpm install --frozen-lockfile", teardownCommand: "", agentNotes: "", demoSeedCommand: "", uiPaths: "" });
});

test("editing submits the teardown command and the agent notes, and says to keep secrets out of the notes", async () => {
  render(<EditProjectDialog project={{ ...project, teardownCommand: "dropdb app_test", agentNotes: "Postgres runs on 5433." }} open onOpenChange={() => {}} />);
  expect(screen.getByLabelText("Teardown command")).toHaveValue("dropdb app_test");
  expect(screen.getByLabelText("Agent notes")).toHaveValue("Postgres runs on 5433.");
  expect(screen.getByText(/Do not put secrets here/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Teardown command"), { target: { value: "dropdb --if-exists app_test_$HANDOFF_RUN_SHORT" } });
  fireEvent.change(screen.getByLabelText("Agent notes"), { target: { value: "The database container is shared and already running." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.updateProjectAction).toHaveBeenCalledTimes(1));
  const form = (actions.updateProjectAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("teardownCommand")).toBe("dropdb --if-exists app_test_$HANDOFF_RUN_SHORT");
  expect(form.get("agentNotes")).toBe("The database container is shared and already running.");
});

test("editing submits the demo seed command and the UI paths, one glob a line, and names the defaults", async () => {
  render(<EditProjectDialog project={{ ...project, demoSeedCommand: "pnpm db:seed", uiPaths: ["apps/web/**", "packages/ui/**"] }} open onOpenChange={() => {}} />);
  expect(screen.getByLabelText("Demo seed command")).toHaveValue("pnpm db:seed");
  expect(screen.getByLabelText("UI paths")).toHaveValue("apps/web/**\npackages/ui/**");
  expect(screen.getByText(/\*\*\/components\/\*\*/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("UI paths"), { target: { value: "apps/web/**" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.updateProjectAction).toHaveBeenCalledTimes(1));
  const form = (actions.updateProjectAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("demoSeedCommand")).toBe("pnpm db:seed");
  expect(form.get("uiPaths")).toBe("apps/web/**");
});

test("deleting asks first, says what goes, and shows a refusal", async () => {
  render(<DeleteProjectDialog project={project} open onOpenChange={() => {}} />);
  expect(screen.getByText(/8 runs/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
  await waitFor(() => expect(actions.deleteProjectAction).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("The project has 1 active run. Cancel it first.")).toBeInTheDocument();
});

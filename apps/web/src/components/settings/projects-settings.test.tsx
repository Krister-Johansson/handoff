import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ProjectsSettings, type ProjectRow } from "./projects-settings";

const actions = vi.hoisted(() => ({
  listReposAction: vi.fn(async () => ({ repos: [] })),
  createProjectAction: vi.fn(async () => ({})),
  updateProjectAction: vi.fn(async () => ({ ok: true })),
  deleteProjectAction: vi.fn(async () => ({ ok: true })),
  unlinkPlanAction: vi.fn(async () => ({ ok: true })),
  moveProjectAction: vi.fn(async () => ({ ok: true })),
  listGitHubProjectsAction: vi.fn(async () => ({ projects: [] })),
  setupPlanAction: vi.fn(async () => ({ ok: true })),
  addEstimateFieldsAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
  addDateFieldsAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
}));
vi.mock("@/app/projects/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockClear();
});

const handoff: ProjectRow = {
  id: "p1",
  name: "handoff",
  repoOwner: "octo",
  repoName: "handoff",
  defaultBranch: "main",
  setupCommand: "pnpm install",
  isDemo: false,
  planMode: "timeline",
  runCount: 12,
  plan: { number: 5, title: "handoff plan", url: "https://github.com/users/octo/projects/5" },
};
const shop: ProjectRow = { ...handoff, id: "p2", name: "example-shop", repoName: "example-shop", setupCommand: null, runCount: 7, plan: null };

/** The value next to a term in the open project's details. */
const detail = (term: string) => screen.getByText(term, { selector: "dt" }).nextElementSibling as HTMLElement;

test("lists projects and expands one to show repository, branch, setup command and plan link", () => {
  render(<ProjectsSettings projects={[handoff, shop]} />);
  expect(screen.getByText("12 runs")).toBeInTheDocument();
  expect(screen.getByText("7 runs")).toBeInTheDocument();
  expect(screen.queryByText("Setup command")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(screen.getByRole("button", { name: "Hide handoff" })).toHaveAttribute("aria-expanded", "true");
  expect(detail("Repository")).toHaveTextContent("octo/handoff");
  expect(detail("Default branch")).toHaveTextContent("main");
  expect(detail("Setup command")).toHaveTextContent("pnpm install");
  expect(within(detail("Plan on GitHub")).getByRole("link", { name: /handoff plan/ })).toHaveAttribute("href", "https://github.com/users/octo/projects/5");
  expect(detail("Plan on GitHub")).toHaveTextContent("#5");

  // One project is open at a time; another without a plan offers to set one up.
  fireEvent.click(screen.getByRole("button", { name: "Show example-shop" }));
  expect(screen.getByRole("button", { name: "Show handoff" })).toHaveAttribute("aria-expanded", "false");
  expect(detail("Setup command")).toHaveTextContent("none");
  expect(within(detail("Plan on GitHub")).getByRole("button", { name: "Set up the plan" })).toBeInTheDocument();
});

test("a project with the scheduler on shows its active runs of max_runs", () => {
  render(
    <ProjectsSettings
      projects={[
        { ...handoff, scheduler: { state: "held", active: 1, maxRuns: 2 } },
        { ...shop, scheduler: { state: "paused", active: 0, maxRuns: 1 } },
        { ...shop, id: "p3", name: "demo" },
      ]}
    />,
  );
  expect(within(screen.getByRole("button", { name: "Show handoff" })).getByText("Scheduler held, 1 of 2")).toBeInTheDocument();
  expect(within(screen.getByRole("button", { name: "Show example-shop" })).getByText("Scheduler paused")).toBeInTheDocument();
  expect(within(screen.getByRole("button", { name: "Show demo" })).queryByText(/Scheduler/)).not.toBeInTheDocument();
});

test("the open project shows its teardown command and agent notes", () => {
  render(<ProjectsSettings projects={[{ ...handoff, teardownCommand: "dropdb app_test", agentNotes: "Postgres runs on 5433." }, shop]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(detail("Teardown command")).toHaveTextContent("dropdb app_test");
  expect(detail("Agent notes")).toHaveTextContent("Postgres runs on 5433.");
  fireEvent.click(screen.getByRole("button", { name: "Show example-shop" }));
  expect(detail("Teardown command")).toHaveTextContent("none");
  expect(detail("Agent notes")).toHaveTextContent("none");
});

test("the open project shows its demo seed command and UI paths, or that the defaults apply", () => {
  render(<ProjectsSettings projects={[{ ...handoff, demoSeedCommand: "pnpm db:seed", uiPaths: ["apps/web/**", "packages/ui/**"] }, shop]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(detail("Demo seed command")).toHaveTextContent("pnpm db:seed");
  expect(detail("UI paths")).toHaveTextContent("apps/web/** packages/ui/**");
  fireEvent.click(screen.getByRole("button", { name: "Show example-shop" }));
  expect(detail("Demo seed command")).toHaveTextContent("none");
  expect(detail("UI paths")).toHaveTextContent("the defaults");
});

test("the open project shows its permission timeout in minutes", () => {
  render(<ProjectsSettings projects={[{ ...handoff, permissionTimeoutMinutes: 25 }, { ...shop, permissionTimeoutMinutes: 1 }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(detail("Permission timeout")).toHaveTextContent("25 minutes");
  fireEvent.click(screen.getByRole("button", { name: "Show example-shop" }));
  expect(detail("Permission timeout")).toHaveTextContent("1 minute");
});

test("Add project opens the add form", async () => {
  const { unmount } = render(<ProjectsSettings projects={[handoff]} />);
  fireEvent.click(screen.getByRole("button", { name: "Add project" }));
  const dialog = await screen.findByRole("dialog", { name: "Add a project" });
  expect(within(dialog).getByLabelText("Default branch")).toBeInTheDocument();
  expect(actions.listReposAction).toHaveBeenCalledTimes(1);
  unmount();

  // The switcher's Add project lands here with the form already open.
  render(<ProjectsSettings projects={[]} adding />);
  expect(await screen.findByRole("dialog", { name: "Add a project" })).toBeInTheDocument();
});

test("Delete asks first", async () => {
  render(<ProjectsSettings projects={[handoff, shop]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  const ask = await screen.findByRole("alertdialog", { name: "Delete handoff?" });
  expect(ask).toHaveTextContent("12 runs");
  fireEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  expect(actions.deleteProjectAction).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete project" }));
  await waitFor(() => expect(actions.deleteProjectAction).toHaveBeenCalledTimes(1));
  const form = (actions.deleteProjectAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("projectId")).toBe("p1");
});

test("Unlink asks first, then forgets the plan's GitHub Project", async () => {
  render(<ProjectsSettings projects={[handoff]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  fireEvent.click(within(detail("Plan on GitHub")).getByRole("button", { name: "Unlink" }));
  const ask = await screen.findByRole("alertdialog", { name: "Unlink handoff plan from handoff?" });
  expect(ask).toHaveTextContent("The Project, its items and the labels stay on GitHub.");
  expect(actions.unlinkPlanAction).not.toHaveBeenCalled();
  fireEvent.click(within(ask).getByRole("button", { name: "Unlink" }));
  await waitFor(() => expect(actions.unlinkPlanAction).toHaveBeenCalledWith({ projectId: "p1" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
});

test("Edit opens the edit form with the project's name, branch and setup command", async () => {
  render(<ProjectsSettings projects={[handoff]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit project" });
  expect(within(dialog).getByLabelText("Name")).toHaveValue("handoff");
  expect(within(dialog).getByLabelText("Default branch")).toHaveValue("main");
  expect(within(dialog).getByLabelText("Setup command")).toHaveValue("pnpm install");
});

test("Repository moved opens the move dialog for the open project, which names its plan and its running scheduler", async () => {
  render(<ProjectsSettings projects={[{ ...handoff, scheduler: { state: "running", active: 1, maxRuns: 2 } }, shop]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  fireEvent.click(screen.getByRole("button", { name: "Repository moved" }));
  const dialog = await screen.findByRole("dialog", { name: "Repository moved" });
  expect(dialog).toHaveTextContent("octo/handoff");
  fireEvent.change(within(dialog).getByLabelText("New repository"), { target: { value: "acme/handoff" } });
  expect(dialog).toHaveTextContent("The plan's GitHub Project belongs to octo, so it is unlinked; set up the plan again. The scheduler pauses.");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.moveProjectAction).toHaveBeenCalledTimes(1));
  expect(Object.fromEntries((actions.moveProjectAction.mock.calls[0] as unknown[])[1] as FormData)).toEqual({ projectId: "p1", repo: "acme/handoff" });
});

test("the demo project has no Repository moved", () => {
  render(<ProjectsSettings projects={[{ ...handoff, isDemo: true }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(screen.queryByRole("button", { name: "Repository moved" })).not.toBeInTheDocument();
});

test("Plan on GitHub lists the fields and offers Add the fields when Size or Estimate is missing", async () => {
  const fieldsOf = () => within(within(detail("Plan on GitHub")).getByRole("list", { name: "Fields" })).getAllByRole("listitem").map((li) => li.textContent);
  const all = { start: true, target: true, size: true, estimate: true };
  const { unmount } = render(<ProjectsSettings projects={[{ ...handoff, plan: { ...handoff.plan!, fields: all } }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(fieldsOf()).toEqual(["Start", "Target", "Size: S, M, L", "Estimate, Number"]);
  expect(screen.queryByRole("button", { name: "Add the fields" })).not.toBeInTheDocument();
  unmount();

  actions.addEstimateFieldsAction.mockResolvedValueOnce({ ok: false, error: "GitHub refused the field." });
  render(<ProjectsSettings projects={[{ ...handoff, plan: { ...handoff.plan!, fields: { ...all, size: false, estimate: false } } }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(fieldsOf()).toEqual(["Start", "Target", "No Size field", "No Estimate field"]);
  fireEvent.click(within(detail("Plan on GitHub")).getByRole("button", { name: "Add the fields" }));
  await waitFor(() => expect(actions.addEstimateFieldsAction).toHaveBeenCalledWith({ projectId: "p1" }));
  expect(actions.addDateFieldsAction).not.toHaveBeenCalled();
  expect(await within(detail("Plan on GitHub")).findByText("GitHub refused the field.")).toBeInTheDocument();
});

test("a Project without Start and Target gets them from Add the fields too", async () => {
  render(<ProjectsSettings projects={[{ ...handoff, plan: { ...handoff.plan!, fields: { start: false, target: false, size: true, estimate: true } } }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  fireEvent.click(within(detail("Plan on GitHub")).getByRole("button", { name: "Add the fields" }));
  await waitFor(() => expect(actions.addDateFieldsAction).toHaveBeenCalledWith({ projectId: "p1" }));
  expect(actions.addEstimateFieldsAction).not.toHaveBeenCalled();
});

test("a Flow project lists and adds only the Size field", async () => {
  const fieldsOf = () => within(within(detail("Plan on GitHub")).getByRole("list", { name: "Fields" })).getAllByRole("listitem").map((li) => li.textContent);
  const none = { start: false, target: false, size: false, estimate: false };
  const { unmount } = render(<ProjectsSettings projects={[{ ...handoff, planMode: "flow", plan: { ...handoff.plan!, fields: { ...none, size: true } } }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(fieldsOf()).toEqual(["Size: S, M, L"]);
  expect(screen.queryByRole("button", { name: "Add the fields" })).not.toBeInTheDocument();
  unmount();

  render(<ProjectsSettings projects={[{ ...handoff, planMode: "flow", plan: { ...handoff.plan!, fields: none } }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(fieldsOf()).toEqual(["No Size field"]);
  fireEvent.click(within(detail("Plan on GitHub")).getByRole("button", { name: "Add the fields" }));
  await waitFor(() => expect(actions.addEstimateFieldsAction).toHaveBeenCalledWith({ projectId: "p1" }));
  expect(actions.addDateFieldsAction).not.toHaveBeenCalled();
});

test("capacity, forecasts and the plan budget are in project settings, not here", () => {
  render(<ProjectsSettings projects={[handoff]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(screen.queryByText("Plan budget", { selector: "dt" })).not.toBeInTheDocument();
  expect(within(detail("Estimates")).getByRole("link", { name: "Project settings, Estimates" })).toHaveAttribute("href", "/projects/p1/settings?tab=estimates");
  expect(detail("Estimates")).toHaveTextContent("Capacity, forecasts and the plan budget are in Project settings, Estimates.");
});

test("a Flow project points to its plan budget only, since it has no capacity or forecasts", () => {
  render(<ProjectsSettings projects={[{ ...handoff, planMode: "flow" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "Show handoff" }));
  expect(screen.queryByText("Estimates", { selector: "dt" })).not.toBeInTheDocument();
  const row = detail("Plan budget");
  expect(row).toHaveTextContent("The plan budget is in Project settings, Plan budget.");
  expect(row).not.toHaveTextContent(/capacity|forecast/i);
  expect(within(row).getByRole("link", { name: "Project settings, Plan budget" })).toHaveAttribute("href", "/projects/p1/settings?tab=estimates");
});

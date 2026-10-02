import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PlanEmpty } from "./plan-empty";

const actions = vi.hoisted(() => ({
  setupPlanAction: vi.fn(async () => ({ ok: true })),
  listGitHubProjectsAction: vi.fn(async () => ({
    projects: [
      { number: 4, title: "handoff roadmap", url: "https://github.com/users/o/projects/4", linked: true, missing_status_options: ["Shaping", "Ready", "Running", "In review"] },
      { number: 3, title: "gqlPrune Roadmap", url: "https://github.com/users/o/projects/3", linked: false, missing_status_options: [] },
    ],
  })),
}));
vi.mock("@/app/projects/actions", () => actions);

const assistant = vi.hoisted(() => ({ open: vi.fn(), available: true, composerRef: { current: null as HTMLTextAreaElement | null } }));
vi.mock("@/components/assistant/assistant-provider", () => ({ useOptionalAssistant: () => assistant }));

const project = { id: "p1", name: "handoff", repo: "o/handoff" };

test("no plan offers Set up the plan, a missing scope shows the commands, an empty plan offers Shape with the assistant", async () => {
  const { unmount } = render(<PlanEmpty reason="no-plan" project={project} />);
  expect(screen.getByText("No plan on GitHub yet")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Set up the plan" }));
  const dialog = await screen.findByRole("dialog", { name: "Set up the plan" });
  expect(await within(dialog).findByRole("radio", { name: /handoff roadmap/ })).toBeChecked();
  expect(within(dialog).getByText("Linked to o/handoff")).toBeInTheDocument();
  expect(within(dialog).getByText(/Renames or adds Shaping, Ready, Running and In review/)).toBeInTheDocument();
  expect(within(dialog).getByText('"handoff plan", linked to o/handoff')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("radio", { name: /gqlPrune Roadmap/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Use this Project" }));
  await waitFor(() => expect(actions.setupPlanAction).toHaveBeenLastCalledWith({ projectId: "p1", use: 3 }));
  fireEvent.click(within(dialog).getByRole("radio", { name: /Create a new Project/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "Create a new Project" }));
  await waitFor(() => expect(actions.setupPlanAction).toHaveBeenLastCalledWith({ projectId: "p1" }));
  unmount();

  const scope = render(<PlanEmpty reason="no-scope" project={project} />);
  expect(screen.getByText("GitHub Projects need the project scope")).toBeInTheDocument();
  expect(screen.getByText("gh auth refresh -s project")).toBeInTheDocument();
  expect(screen.getByText("GITHUB_TOKEN=$(gh auth token)")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Set up the plan" })).not.toBeInTheDocument();
  scope.unmount();

  const composer = document.createElement("textarea");
  document.body.append(composer);
  assistant.composerRef.current = composer;
  render(<PlanEmpty reason="empty" project={project} />);
  expect(screen.getByText("Nothing shaped yet")).toBeInTheDocument();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Shape with the assistant" }));
  vi.runAllTimers();
  vi.useRealTimers();
  expect(assistant.open).toHaveBeenCalled();
  expect(composer.value).toBe("Shape work in handoff: ");
  composer.remove();
});

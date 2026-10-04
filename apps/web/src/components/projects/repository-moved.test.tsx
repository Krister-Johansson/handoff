import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { RepositoryMovedDialog } from "./repository-moved";

const actions = vi.hoisted(() => ({ moveProjectAction: vi.fn<(state: unknown, form: FormData) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true })) }));
vi.mock("@/app/projects/actions", () => actions);

beforeEach(() => actions.moveProjectAction.mockClear());

const project = { id: "p1", name: "web", repoOwner: "Krister-Johansson", repoName: "web", plan: { number: 5 }, schedulerOn: true };

test("the dialog says the plan is unlinked and the scheduler pauses, and Save moves the project", async () => {
  const onOpenChange = vi.fn();
  render(<RepositoryMovedDialog project={project} open onOpenChange={onOpenChange} />);
  expect(screen.getByRole("dialog", { name: "Repository moved" })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("New repository"), { target: { value: "Task-Insight/web" } });
  expect(screen.getByText(/^handoff will use/)).toHaveTextContent(
    "handoff will use Task-Insight/web for this project's runs. The plan's GitHub Project belongs to Krister-Johansson, so it is unlinked; set up the plan again. The scheduler pauses.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(actions.moveProjectAction).toHaveBeenCalledTimes(1));
  expect(Object.fromEntries(actions.moveProjectAction.mock.calls[0]![1])).toEqual({ projectId: "p1", repo: "Task-Insight/web" });
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});

test("a move within the same owner keeps the plan and the scheduler, and a refusal shows", async () => {
  actions.moveProjectAction.mockResolvedValueOnce({ ok: false, error: "The project has 1 active run. Let it finish or cancel it, then move the repository." });
  const onOpenChange = vi.fn();
  render(<RepositoryMovedDialog project={project} open onOpenChange={onOpenChange} />);

  fireEvent.change(screen.getByLabelText("New repository"), { target: { value: "Krister-Johansson/web-app" } });
  expect(screen.getByText(/^handoff will use/)).toHaveTextContent("handoff will use Krister-Johansson/web-app for this project's runs.");
  expect(screen.queryByText(/unlinked/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText(/1 active run/)).toBeInTheDocument();
  expect(onOpenChange).not.toHaveBeenCalled();
});

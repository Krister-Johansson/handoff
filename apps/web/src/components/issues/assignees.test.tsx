import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { Toaster } from "@/components/ui/sonner";
import { Assignees } from "./assignees";
import { StartRunButton } from "./issue-actions";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
const actions = vi.hoisted(() => ({ assignAction: vi.fn(), assignableAction: vi.fn(), startIssueRunAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/app/projects/issue-actions", () => actions);
vi.mock("@/app/projects/actions", () => ({ moveToReadyAction: vi.fn(), moveToShapingAction: vi.fn(), planIssueAction: vi.fn(), scheduleAction: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  actions.assignableAction.mockResolvedValue({
    repo: "Krister-Johansson/todoOverKill",
    users: [
      { login: "Krister-Johansson", avatarUrl: "a1", you: true },
      { login: "ann", avatarUrl: "a2", you: false },
    ],
  });
});

/** Under a full test run the transitions take a while; the waits allow for it. */
const SLOW = { timeout: 8000 };
vi.setConfig({ testTimeout: 30_000 });

const open = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog", { name: "Assignees of #66" }, SLOW);
};

test("the picker lists who can be assigned with you marked, and picking someone assigns them on GitHub", async () => {
  actions.assignAction.mockResolvedValue({ ok: true, assignees: ["ann"] });
  render(<Assignees projectId="p1" issue={66} assignees={[]} viewer="Krister-Johansson" assignMe />);
  const picker = await open("No assignee. Change assignees");
  expect(within(picker).getByPlaceholderText("Filter people")).toBeInTheDocument();
  const you = await within(picker).findByRole("option", { name: /Krister-Johansson/ }, SLOW);
  expect(you).toHaveTextContent("you");
  expect(picker).toHaveTextContent("People who can be assigned in Krister-Johansson/todoOverKill");
  fireEvent.click(within(picker).getByRole("option", { name: /ann/ }));
  await waitFor(() => expect(actions.assignAction).toHaveBeenCalledWith({ projectId: "p1", issue: 66, logins: ["ann"] }), SLOW);
  expect(await screen.findByRole("button", { name: "Assignee: ann. Change assignees" }, SLOW)).toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();
});

test("Assign me assigns the token's user beside whoever has the issue, and Clear assignees removes everyone", async () => {
  actions.assignAction.mockResolvedValueOnce({ ok: true, assignees: ["ann", "Krister-Johansson"] }).mockResolvedValueOnce({ ok: true, assignees: [] });
  render(<Assignees projectId="p1" issue={66} assignees={["ann"]} viewer="Krister-Johansson" assignMe />);
  fireEvent.click(screen.getByRole("button", { name: "Assign me" }));
  await waitFor(() => expect(actions.assignAction).toHaveBeenCalledWith({ projectId: "p1", issue: 66, logins: ["ann"], me: true }), SLOW);
  expect(await screen.findByRole("button", { name: "Assignees: ann, Krister-Johansson. Change assignees" }, SLOW)).toBeInTheDocument();
  // Once you have it, Assign me goes.
  expect(screen.queryByRole("button", { name: "Assign me" })).not.toBeInTheDocument();

  const picker = await open("Assignees: ann, Krister-Johansson. Change assignees");
  fireEvent.click(await within(picker).findByRole("option", { name: "Clear assignees" }, SLOW));
  await waitFor(() => expect(actions.assignAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 66, logins: [] }), SLOW);
});

test("a refused assignment says why, and without a token's user there is no Assign me", async () => {
  actions.assignAction.mockResolvedValue({ ok: false, error: "stranger cannot be assigned in Krister-Johansson/todoOverKill." });
  const { unmount } = render(<Assignees projectId="p1" issue={66} assignees={[]} viewer="Krister-Johansson" assignMe />);
  fireEvent.click(screen.getByRole("button", { name: "Assign me" }));
  expect(await screen.findByRole("alert", {}, SLOW)).toHaveTextContent("stranger cannot be assigned");
  unmount();
  render(<Assignees projectId="p1" issue={66} assignees={[]} viewer={undefined} assignMe />);
  expect(screen.queryByRole("button", { name: "Assign me" })).not.toBeInTheDocument();
});

test("Start run on the page starts the run, stays, and the toast says the issue was assigned to you", async () => {
  actions.startIssueRunAction.mockResolvedValue({ ok: true, runId: "r66", assigned: "Krister-Johansson" });
  render(
    <>
      <StartRunButton issue={{ number: 66, title: "F52 Tasks service follow-ups" }} projectId="p1" graphs={["master"]} graphName="master" />
      <Toaster />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start run" }));
  const dialog = await screen.findByRole("dialog", { name: "Start a run on #66 F52 Tasks service follow-ups" }, SLOW);
  fireEvent.click(within(dialog).getByRole("button", { name: "Start run" }));
  await waitFor(() => expect(actions.startIssueRunAction).toHaveBeenCalledWith({ projectId: "p1", issue: 66, graphName: "master" }), SLOW);
  expect(await screen.findByText("Run started", {}, SLOW)).toBeInTheDocument();
  expect(screen.getByText("#66 had no assignee, so it is assigned to you.")).toBeInTheDocument();
  expect(router.refresh).toHaveBeenCalled();
  expect(router.push).not.toHaveBeenCalled();
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { TryItCard } from "./try-it-card";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn(), restartTryItAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => {
  actions.answerReviewAction.mockReset().mockResolvedValue({ ok: true });
  actions.restartTryItAction.mockReset().mockResolvedValue({ ok: true });
});

const question = (preview: Record<string, unknown>, acceptance = ["A user can create a new task", "Tasks persist after a reload"]) => ({
  id: "11111111-1111-4111-8111-111111111111",
  runId: "22222222-2222-4222-8222-222222222222",
  question: "Try the app and check each acceptance criterion.",
  context: { reason: "try", acceptance, preview },
});

test("the card opens the running app and lists each acceptance criterion to check", () => {
  render(<TryItCard item={question({ id: "p1", url: "http://localhost:41000", status: "running" })} />);
  expect(screen.getByRole("link", { name: /Open the app/ })).toHaveAttribute("href", "http://localhost:41000");
  const items = within(screen.getByRole("list", { name: "Acceptance criteria" })).getAllByRole("listitem");
  expect(items.map((i) => within(i).getByText(/./, { selector: "span" }).textContent)).toEqual(["A user can create a new task", "Tasks persist after a reload"]);
  // Nothing is decided until every item is checked.
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
});

test("approving needs every item to work", async () => {
  render(<TryItCard item={question({ id: "p1", url: "http://localhost:41000", status: "running" })} />);
  for (const works of screen.getAllByRole("button", { name: "Works" })) fireEvent.click(works);
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() =>
    expect(actions.answerReviewAction).toHaveBeenCalledWith({
      questionId: "11111111-1111-4111-8111-111111111111",
      runId: "22222222-2222-4222-8222-222222222222",
      option: "approve",
      note: "",
      comments: [],
    }),
  );
});

test("an item that does not work sends the work back with what is wrong", async () => {
  render(<TryItCard item={question({ id: "p1", url: "http://localhost:41000", status: "running" })} />);
  const [first, second] = screen.getAllByRole("listitem");
  fireEvent.click(within(first!).getByRole("button", { name: "Works" }));
  fireEvent.click(within(second!).getByRole("button", { name: "Doesn't work" }));
  fireEvent.change(within(second!).getByLabelText("What is wrong?"), { target: { value: "The list is empty after a reload" } });
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Send back" }));
  await waitFor(() =>
    expect(actions.answerReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({ option: "changes", comments: [{ quote: "Tasks persist after a reload", body: "The list is empty after a reload" }] }),
    ),
  );
});

test("an app that did not start says why and can be started again", async () => {
  render(<TryItCard item={question({ status: "failed", error: "This repository has no .claude/launch.json" }, [])} />);
  expect(screen.getByText(/no \.claude\/launch\.json/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open the app/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start the app again" }));
  await waitFor(() => expect(actions.restartTryItAction).toHaveBeenCalledWith({ questionId: "11111111-1111-4111-8111-111111111111", runId: "22222222-2222-4222-8222-222222222222" }));
  // Without criteria, the person approves or sends back with a note.
  await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
});

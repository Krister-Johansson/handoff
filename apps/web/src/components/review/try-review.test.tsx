import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { TryReview } from "./try-review";

const actions = vi.hoisted(() => ({ answerReviewAction: vi.fn(), restartTryItAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => {
  actions.answerReviewAction.mockReset().mockResolvedValue({ ok: true });
  actions.restartTryItAction.mockReset().mockResolvedValue({ ok: true });
  Element.prototype.scrollIntoView = vi.fn();
});

const QUESTION = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const running = { id: "p1", url: "http://localhost:41000", status: "running" as const };
const props = {
  questionId: QUESTION,
  runId: RUN,
  from: "coder-1",
  acceptance: ["A user can create a new project", "The project shows in the sidebar", "pnpm lint passes"],
  preview: running,
  shots: [
    { id: "a1", caption: "The create dialog", criterion: "A user can create a new project", works: true },
    { id: "a2", caption: "The sidebar", criterion: "The project shows in the sidebar", works: true },
    { id: "a3", caption: "Dark theme at 320 px", works: true },
  ],
};

const section = (name: string) => screen.getByRole("region", { name });

test("each criterion is a section to check, with its screenshots, and the app opens from the top", () => {
  render(<TryReview {...props} />);
  expect(screen.getByRole("link", { name: /Open the app/ })).toHaveAttribute("href", "http://localhost:41000");
  expect(screen.getByRole("button", { name: /1 of 3/ })).toBeInTheDocument();
  expect(screen.getByText("0 of 3 checked")).toBeInTheDocument();
  expect(within(section("A user can create a new project")).getByRole("img", { name: "The create dialog" })).toBeInTheDocument();
  // Screenshots that show no criterion get their own section at the end.
  expect(within(section("Other screenshots")).getByRole("img", { name: "Dark theme at 320 px" })).toBeInTheDocument();
});

test("marking a criterion as working collapses it and moves on to the next one to check", () => {
  render(<TryReview {...props} />);
  const first = section("A user can create a new project");
  fireEvent.click(within(first).getByRole("checkbox", { name: "Works" }));
  expect(within(first).getByRole("button", { name: "Expand A user can create a new project" })).toHaveAttribute("aria-expanded", "false");
  expect(within(first).queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText("1 of 3 checked")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /2 of 3/ })).toBeInTheDocument();
  // ] moves on, [ goes back.
  fireEvent.keyDown(window, { key: "]" });
  expect(screen.getByRole("button", { name: /3 of 3/ })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "[" });
  expect(screen.getByRole("button", { name: /2 of 3/ })).toBeInTheDocument();
});

test("approving needs every criterion to work", async () => {
  render(<TryReview {...props} />);
  for (const name of props.acceptance) fireEvent.click(within(section(name)).getByRole("checkbox", { name: "Works" }));
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  await waitFor(() => expect(actions.answerReviewAction).toHaveBeenCalledWith({ questionId: QUESTION, runId: RUN, option: "approve", note: "", comments: [] }));
});

test("a criterion that does not work stays open for what is wrong, and goes back to the coder", async () => {
  render(<TryReview {...props} />);
  const second = section("The project shows in the sidebar");
  fireEvent.click(within(second).getByRole("button", { name: "Doesn't work" }));
  fireEvent.change(within(second).getByLabelText("What is wrong?"), { target: { value: "It shows only after a reload." } });
  fireEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Send back to coder-1" }));
  await waitFor(() =>
    expect(actions.answerReviewAction).toHaveBeenCalledWith(
      expect.objectContaining({ option: "changes", comments: [{ quote: "The project shows in the sidebar", body: "It shows only after a reload." }] }),
    ),
  );
});

test("an app that did not start says why and can be started again", async () => {
  render(<TryReview {...props} preview={{ status: "failed", error: "This repository has no .claude/launch.json" }} />);
  expect(screen.getByText(/no \.claude\/launch\.json/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open the app/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Start the app again" }));
  await waitFor(() => expect(actions.restartTryItAction).toHaveBeenCalledWith({ questionId: QUESTION, runId: RUN }));
});

test("an answered review shows each criterion's result and asks nothing more", () => {
  render(<TryReview {...props} answered={{ option: "changes", comments: [{ quote: "The project shows in the sidebar", body: "Only after a reload." }] }} />);
  expect(within(section("The project shows in the sidebar")).getByText("Only after a reload.")).toBeInTheDocument();
  expect(within(section("The project shows in the sidebar")).getByText("Doesn't work")).toBeInTheDocument();
  expect(within(section("A user can create a new project")).getByText("Works")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

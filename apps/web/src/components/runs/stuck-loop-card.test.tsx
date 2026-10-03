import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { StuckLoopCard } from "./stuck-loop-card";

const actions = vi.hoisted(() => ({ resolveLoopAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => {
  actions.resolveLoopAction.mockReset().mockResolvedValue({ ok: true });
});

test("a run stuck on a loop says where, and each choice is sent as the person's decision", async () => {
  render(<StuckLoopCard runId="r1" node="Code review" loop="code_review-1->coder-1" attempts={3} />);
  expect(screen.getByText(/Code review sent the work back 3 times/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Go on as if approved" }));
  await waitFor(() => expect(actions.resolveLoopAction).toHaveBeenCalledWith({ runId: "r1", action: "continue" }));
  expect(screen.getByRole("button", { name: "Another round" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop the run" })).toBeInTheDocument();
});

test("the chosen button shows that it is working until the page refreshes", async () => {
  let settle: (value: { ok: boolean; error?: string }) => void = () => {};
  actions.resolveLoopAction.mockImplementation(() => new Promise((resolve) => (settle = resolve)));
  render(<StuckLoopCard runId="r1" node="Code review" loop="code_review-1->coder-1" attempts={3} />);
  const chosen = screen.getByRole("button", { name: "Another round" });
  fireEvent.click(chosen);
  await waitFor(() => expect(chosen).toHaveAttribute("aria-busy", "true"));
  const other = screen.getByRole("button", { name: "Go on as if approved" });
  expect(other).not.toHaveAttribute("aria-busy");
  expect(other).toBeDisabled();
  // Sent: the card stays until the refreshed page drops it, and the chosen button keeps working.
  await act(async () => settle({ ok: true }));
  expect(chosen).toHaveAttribute("aria-busy", "true");
  expect(chosen).toBeDisabled();
});

test("a refused decision stops working and says why", async () => {
  actions.resolveLoopAction.mockResolvedValue({ ok: false, error: "The graph no longer has code_review-1->coder-1." });
  render(<StuckLoopCard runId="r1" node="Code review" loop="code_review-1->coder-1" attempts={3} />);
  const chosen = screen.getByRole("button", { name: "Another round" });
  fireEvent.click(chosen);
  expect(await screen.findByText("The graph no longer has code_review-1->coder-1.")).toBeInTheDocument();
  expect(chosen).not.toHaveAttribute("aria-busy");
  // The error and the cleared choice commit before the transition ends, so the buttons stay disabled
  // until the pending flag drops in a later render.
  await waitFor(() => expect(chosen).toBeEnabled());
});

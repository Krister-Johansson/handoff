import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { StuckLoopCard } from "./stuck-loop-card";

const actions = vi.hoisted(() => ({ resolveLoopAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => actions.resolveLoopAction.mockReset().mockResolvedValue({ ok: true }));

test("a run stuck on a loop says where, and each choice is sent as the person's decision", async () => {
  render(<StuckLoopCard runId="r1" node="Code review" loop="code_review-1->coder-1" attempts={3} />);
  expect(screen.getByText(/Code review sent the work back 3 times/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Go on as if approved" }));
  await waitFor(() => expect(actions.resolveLoopAction).toHaveBeenCalledWith({ runId: "r1", action: "continue" }));
  expect(screen.getByRole("button", { name: "Another round" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Stop the run" })).toBeInTheDocument();
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { PathsQuestionCard } from "./paths-question-card";

const actions = vi.hoisted(() => ({ answerAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => actions.answerAction.mockReset().mockResolvedValue({ ok: true }));

const item = {
  id: "q1",
  runId: "r1",
  projectId: "p1",
  task: "#7 Todo CRUD",
  projectName: "todooverkill",
  nodeKey: "coder",
  reason: "paths",
  question: "coder changed files outside the plan: `pnpm-lock.yaml`, `notes.txt`",
  options: ["allow", "send_back", "fail"],
  context: { reason: "paths", from: "coder", files: ["pnpm-lock.yaml", "notes.txt"] },
};

test("a paths question lists the files and answers with Allow for this run, Send back or Fail the step", async () => {
  render(<PathsQuestionCard item={item} compact />);
  expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
  expect(screen.getByText("notes.txt")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send back" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Fail the step" })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "The lockfile belongs to the dependency change." } });
  fireEvent.click(screen.getByRole("button", { name: "Allow for this run" }));
  await waitFor(() => expect(actions.answerAction).toHaveBeenCalled());
  const form = actions.answerAction.mock.calls[0]![1] as FormData;
  expect([form.get("questionId"), form.get("runId"), form.get("option"), form.get("answer")]).toEqual(["q1", "r1", "allow", "The lockfile belongs to the dependency change."]);
});

test("in the inbox a paths question names its project and run", () => {
  render(<PathsQuestionCard item={item} />);
  expect(screen.getByRole("link", { name: "#7 Todo CRUD" })).toHaveAttribute("href", "/projects/p1/runs/r1");
});

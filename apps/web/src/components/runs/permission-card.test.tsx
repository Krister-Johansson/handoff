import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { PermissionCard } from "./permission-card";

const actions = vi.hoisted(() => ({ answerPermissionAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => actions.answerPermissionAction.mockReset().mockResolvedValue({ ok: true }));

const request = { id: "3f6b2a10-0000-4000-8000-000000000001", runId: "22222222-2222-4222-8222-222222222222", nodeKey: "coder-1", toolName: "Bash", input: { command: "git -C /w log --oneline -8" } };

test("a step waiting on a permission shows what it wants to run, with the rule Always allow would add", () => {
  render(<PermissionCard request={request} />);
  expect(screen.getByRole("heading", { name: "coder-1 asks to run a command" })).toBeInTheDocument();
  expect(screen.getByText("git -C /w log --oneline -8")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Always allow Bash(git *)" })).toBeInTheDocument();
});

test("each answer goes to the step: once, always with its rule, or a denial with a note", async () => {
  const answers: [string, (() => void) | undefined, unknown][] = [
    ["Allow once", undefined, { id: request.id, runId: request.runId, decision: "once" }],
    ["Always allow Bash(git *)", undefined, { id: request.id, runId: request.runId, decision: "always", rule: "Bash(git *)" }],
    [
      "Deny",
      () => fireEvent.change(screen.getByLabelText("Note for Claude (optional)"), { target: { value: "Read the log with the Read tool." } }),
      { id: request.id, runId: request.runId, decision: "deny", message: "Read the log with the Read tool." },
    ],
  ];
  for (const [button, before, sent] of answers) {
    const { unmount } = render(<PermissionCard request={request} />);
    before?.();
    fireEvent.click(screen.getByRole("button", { name: button }));
    await waitFor(() => expect(actions.answerPermissionAction).toHaveBeenLastCalledWith(sent));
    unmount();
  }
});

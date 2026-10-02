import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ProjectCards } from "@/components/inbox/card-place";
import { PermissionCard } from "./permission-card";

const actions = vi.hoisted(() => ({ answerPermissionAction: vi.fn() }));
vi.mock("@/app/inbox/actions", () => actions);
beforeEach(() => actions.answerPermissionAction.mockReset().mockResolvedValue({ ok: true }));

const request = { id: "3f6b2a10-0000-4000-8000-000000000001", runId: "22222222-2222-4222-8222-222222222222", nodeKey: "coder-1", toolName: "Bash", input: { command: "git -C /w log --oneline -8" }, createdAt: new Date() };

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

test("the card's form is a WebMCP tool with Allow once and Deny as its submit controls", async () => {
  render(<PermissionCard request={request} />);
  const form = screen.getByRole("button", { name: "Deny" }).closest("form")!;
  expect(form).toHaveAttribute("toolname", `answer_permission_${request.id}`);
  expect(form.getAttribute("tooldescription")).toMatch(/coder-1 asks to run a command/);
  expect(form).not.toHaveAttribute("toolautosubmit");
  expect(screen.getByRole("button", { name: "Allow once" })).toHaveAttribute("type", "submit");
  expect(screen.getByRole("button", { name: "Deny" })).toHaveAttribute("type", "submit");
  // Always allow changes the node's rules for later runs: a person's choice, never a form an agent submits.
  expect(screen.getByRole("button", { name: "Always allow Bash(git *)" })).toHaveAttribute("type", "button");
  expect(screen.getByLabelText("Note for Claude (optional)")).toHaveAttribute("toolparamdescription", expect.stringContaining("denial"));
  fireEvent.change(screen.getByLabelText("Note for Claude (optional)"), { target: { value: "Use Read." } });
  fireEvent.click(screen.getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(actions.answerPermissionAction).toHaveBeenCalledWith({ id: request.id, runId: request.runId, decision: "deny", message: "Use Read." }));
});

test("the card says how long the step has waited for an answer", () => {
  render(<PermissionCard request={{ ...request, createdAt: new Date(Date.now() - 8 * 60_000) }} />);
  expect(screen.getByText("asked 8 minutes ago")).toBeInTheDocument();
});

test("in the inbox the card names the project and the run; on a project's page only the run", () => {
  const run = { projectId: "p1", projectName: "handoff", task: "#70 Speak replies with a Stop control" };
  const { unmount } = render(<PermissionCard request={request} run={run} />);
  expect(screen.getByText(/handoff ·/)).toBeInTheDocument();
  unmount();
  render(
    <ProjectCards>
      <PermissionCard request={request} run={run} />
    </ProjectCards>,
  );
  expect(screen.getByRole("link", { name: "#70 Speak replies with a Stop control" })).toHaveAttribute("href", `/projects/p1/runs/${request.runId}`);
  expect(screen.queryByText(/handoff/)).not.toBeInTheDocument();
});

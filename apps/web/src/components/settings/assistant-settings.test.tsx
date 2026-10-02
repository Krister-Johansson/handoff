import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantSettings } from "./assistant-settings";

const actions = vi.hoisted(() => ({ setAssistantEnabledAction: vi.fn(), setAssistantModelAction: vi.fn() }));
vi.mock("@/app/settings/actions", () => actions);
beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({});
});
afterEach(() => localStorage.clear());

test("the Assistant tab shows the model that ran last, lets the person switch the assistant and WebMCP off, and explains what each needs", async () => {
  render(<AssistantSettings hasToken enabled model="sonnet" lastModel="claude-sonnet-5-5" />);
  expect(screen.getByText(/Last ran claude-sonnet-5-5/)).toBeInTheDocument();
  expect(screen.getByText(/Claude Code on your subscription/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "haiku" } });
  await waitFor(() => expect(actions.setAssistantModelAction).toHaveBeenCalledWith("haiku"));

  const assistant = screen.getByRole("switch", { name: "Assistant" });
  expect(assistant).toBeChecked();
  fireEvent.click(assistant);
  await waitFor(() => expect(actions.setAssistantEnabledAction).toHaveBeenCalledWith(false));

  const webmcp = screen.getByRole("switch", { name: "Expose tools to browser agents (WebMCP)" });
  fireEvent.click(webmcp);
  expect(localStorage.getItem("handoff.webmcp")).toBe("off");
  expect(screen.getByText(/Your browser has no WebMCP/)).toBeInTheDocument();
});

test("without a token the switch is disabled and says what to set", () => {
  render(<AssistantSettings hasToken={false} enabled model="sonnet" />);
  expect(screen.getByRole("switch", { name: "Assistant" })).toBeDisabled();
  expect(screen.getByText(/Add CLAUDE_CODE_OAUTH_TOKEN/)).toBeInTheDocument();
  expect(screen.getByText("No turn has run yet.")).toBeInTheDocument();
});

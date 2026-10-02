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
  expect(screen.getByText("Opens with the Assistant button in the header or ⌘J.")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Model"), { target: { value: "haiku" } });
  await waitFor(() => expect(actions.setAssistantModelAction).toHaveBeenCalledWith("haiku"));

  const assistant = screen.getByRole("switch", { name: "Assistant" });
  expect(assistant).toBeChecked();
  fireEvent.click(assistant);
  await waitFor(() => expect(actions.setAssistantEnabledAction).toHaveBeenCalledWith(false));

  // Without WebMCP in the browser the switch is off and says how to get it.
  expect(screen.getByRole("switch", { name: "Expose tools to browser agents (WebMCP)" })).toBeDisabled();
  expect(screen.getByText(/Your browser has no WebMCP/)).toHaveTextContent("chrome://flags/#enable-webmcp-testing");
});

test("with WebMCP in the browser the switch turns it off for this browser", () => {
  Object.defineProperty(document, "modelContext", { value: new EventTarget(), configurable: true });
  try {
    render(<AssistantSettings hasToken enabled model="sonnet" />);
    const webmcp = screen.getByRole("switch", { name: "Expose tools to browser agents (WebMCP)" });
    expect(screen.getByText(/Browser agents on this page can use handoff's tools/)).toBeInTheDocument();
    fireEvent.click(webmcp);
    expect(localStorage.getItem("handoff.webmcp")).toBe("off");
  } finally {
    delete (document as { modelContext?: unknown }).modelContext;
  }
});

test("without a token the switch is disabled and says what to set", () => {
  render(<AssistantSettings hasToken={false} enabled model="sonnet" />);
  expect(screen.getByRole("switch", { name: "Assistant" })).toBeDisabled();
  expect(screen.getByText(/Add CLAUDE_CODE_OAUTH_TOKEN/)).toBeInTheDocument();
  expect(screen.getByText("No turn has run yet.")).toBeInTheDocument();
});

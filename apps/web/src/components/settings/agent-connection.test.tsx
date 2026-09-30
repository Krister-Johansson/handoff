import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AgentConnection } from "./agent-connection";

const actions = vi.hoisted(() => ({ enableAgentAction: vi.fn(), disableAgentAction: vi.fn(), regenerateAgentAction: vi.fn() }));
vi.mock("@/app/settings/actions", () => actions);
beforeEach(() => {
  actions.enableAgentAction.mockReset().mockResolvedValue({ token: "tok-1" });
  actions.disableAgentAction.mockReset().mockResolvedValue({});
  actions.regenerateAgentAction.mockReset().mockResolvedValue({ token: "tok-2" });
});

// Transitions settle slower when every Vitest project runs at once.
const slow = { timeout: 5000 };
const props = { origin: "http://localhost:3000", checkout: "/Users/me/handoff" };

test("with agent connections off there is only the switch", () => {
  render(<AgentConnection {...props} initialToken={undefined} />);
  expect(screen.getByRole("switch", { name: "Enable agent connections" })).not.toBeChecked();
  expect(screen.getByText("Off")).toBeInTheDocument();
  expect(screen.queryByText(/plugin install/)).not.toBeInTheDocument();
});

test("turning them on shows the token and how to connect Claude Code", async () => {
  render(<AgentConnection {...props} initialToken={undefined} />);
  fireEvent.click(screen.getByRole("switch", { name: "Enable agent connections" }));
  await waitFor(() => expect(actions.enableAgentAction).toHaveBeenCalled(), slow);
  expect(await screen.findByText("tok-1", {}, slow)).toBeInTheDocument();
  expect(screen.getByText("/plugin marketplace add Krister-Johansson/handoff")).toBeInTheDocument();
  expect(screen.getByText("/plugin marketplace add /Users/me/handoff")).toBeInTheDocument();
  expect(screen.getByText("/plugin install handoff@handoff")).toBeInTheDocument();
  expect(screen.getByText("claude --dangerously-load-development-channels plugin:handoff@handoff")).toBeInTheDocument();
  expect(screen.getByText('claude mcp add --transport http handoff http://localhost:3000/api/mcp --header "Authorization: Bearer tok-1"')).toBeInTheDocument();
});

test("regenerating replaces the token and turning off removes it", async () => {
  render(<AgentConnection {...props} initialToken="tok-1" />);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  expect(await screen.findByText("tok-2", {}, slow)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("switch", { name: "Enable agent connections" })).toBeEnabled(), slow);
  fireEvent.click(screen.getByRole("switch", { name: "Enable agent connections" }));
  await waitFor(() => expect(actions.disableAgentAction).toHaveBeenCalled(), slow);
  await waitFor(() => expect(screen.queryByText("tok-2")).not.toBeInTheDocument(), slow);
});

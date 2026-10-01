import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AgentConnection } from "./agent-connection";

const actions = vi.hoisted(() => ({ enableAgentAction: vi.fn(), disableAgentAction: vi.fn(), regenerateAgentAction: vi.fn() }));
vi.mock("@/app/settings/actions", () => actions);
beforeEach(() => {
  actions.enableAgentAction.mockReset().mockResolvedValue({ token: "tok1-abcdefgh-9xyz" });
  actions.disableAgentAction.mockReset().mockResolvedValue({});
  actions.regenerateAgentAction.mockReset().mockResolvedValue({ token: "tok2-abcdefgh-8wvu" });
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
  expect(await screen.findByText("tok1…9xyz", {}, slow)).toBeInTheDocument();
  expect(screen.getByText("/plugin marketplace add Krister-Johansson/handoff")).toBeInTheDocument();
  expect(screen.getByText("/plugin marketplace add /Users/me/handoff")).toBeInTheDocument();
  expect(screen.getByText("/plugin install handoff@handoff")).toBeInTheDocument();
  expect(screen.getByText("claude --dangerously-load-development-channels plugin:handoff@handoff")).toBeInTheDocument();
  expect(screen.getByText('claude mcp add --transport http handoff http://localhost:3000/api/mcp --header "Authorization: Bearer tok1…9xyz"')).toBeInTheDocument();
  expect(screen.queryByText(/tok1-abcdefgh-9xyz/)).not.toBeInTheDocument();
});

test("regenerating replaces the token and turning off removes it", async () => {
  render(<AgentConnection {...props} initialToken="tok1-abcdefgh-9xyz" />);
  fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
  expect(await screen.findByText("tok2…8wvu", {}, slow)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("switch", { name: "Enable agent connections" })).toBeEnabled(), slow);
  fireEvent.click(screen.getByRole("switch", { name: "Enable agent connections" }));
  await waitFor(() => expect(actions.disableAgentAction).toHaveBeenCalled(), slow);
  await waitFor(() => expect(screen.queryByText("tok2…8wvu")).not.toBeInTheDocument(), slow);
});

test("the page shows only the ends of the token, and copying takes the whole token", async () => {
  const writeText = vi.fn(async () => {});
  Object.assign(navigator, { clipboard: { writeText } });
  render(<AgentConnection {...props} initialToken="tok1-abcdefgh-9xyz" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy token" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("tok1-abcdefgh-9xyz"));
  fireEvent.click(screen.getByRole("button", { name: "Copy mcp add command" }));
  await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('claude mcp add --transport http handoff http://localhost:3000/api/mcp --header "Authorization: Bearer tok1-abcdefgh-9xyz"'));
});

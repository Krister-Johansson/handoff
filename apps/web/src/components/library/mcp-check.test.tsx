import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { McpCheckResult } from "./mcp-check-result";
import { McpServerForm } from "./forms";

const actions = vi.hoisted(() => ({ saveMcpServer: vi.fn(), saveAgent: vi.fn(), testMcpServerAction: vi.fn() }));
vi.mock("@/app/library/actions", () => actions);

const ok = {
  status: "ok" as const,
  checkedAt: "2026-09-30T10:00:00Z",
  durationMs: 412,
  server: { name: "docs", version: "1.2.3" },
  tools: [
    { name: "search", description: "Search the docs" },
    { name: "fetch", description: "Fetch a page" },
  ],
  resources: 1,
  prompts: 0,
};

test("a working server shows its name, version, tools and counts, and chosen tools can become the allowed tools", () => {
  const onAllow = vi.fn();
  render(<McpCheckResult check={ok} onAllow={onAllow} />);
  expect(screen.getByText("Connected")).toBeInTheDocument();
  expect(screen.getByText(/docs 1\.2\.3/)).toBeInTheDocument();
  expect(screen.getByText(/2 tools, 1 resource, 0 prompts/)).toBeInTheDocument();
  expect(screen.getByText("Search the docs")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "fetch" }));
  fireEvent.click(screen.getByRole("button", { name: "Allow only the ticked tools" }));
  expect(onAllow).toHaveBeenCalledWith(["search"]);
});

test("missing secrets and authentication say what to do", () => {
  const { rerender } = render(<McpCheckResult check={{ ...ok, status: "missing_secrets", tools: [], missingSecrets: ["DOCS_TOKEN"], message: "Not set in this environment: DOCS_TOKEN" }} onAllow={() => {}} />);
  expect(screen.getByText("Missing secrets")).toBeInTheDocument();
  expect(screen.getByText(/DOCS_TOKEN/)).toBeInTheDocument();
  rerender(<McpCheckResult check={{ ...ok, status: "needs_auth", tools: [], message: "The server answered 401" }} onAllow={() => {}} />);
  expect(screen.getByText("Needs authentication")).toBeInTheDocument();
});

test("Test server checks the form's current values, and Allow fills the allowed tools", async () => {
  actions.testMcpServerAction.mockResolvedValue({ check: ok });
  render(<McpServerForm />);
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "docs" } });
  fireEvent.change(screen.getByLabelText("Command"), { target: { value: "npx" } });
  fireEvent.click(screen.getByRole("button", { name: "Test server" }));
  await waitFor(() => expect(actions.testMcpServerAction).toHaveBeenCalled());
  const form = (actions.testMcpServerAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("command")).toBe("npx");
  expect(await screen.findByText("Connected")).toBeInTheDocument();
  // Testing must not clear what was typed, so the server can be tested again or saved.
  expect(screen.getByLabelText("Name")).toHaveValue("docs");
  expect(screen.getByLabelText("Command")).toHaveValue("npx");
  fireEvent.click(screen.getByRole("checkbox", { name: "search" }));
  fireEvent.click(screen.getByRole("button", { name: "Allow only the ticked tools" }));
  expect(screen.getByLabelText("Allowed tools")).toHaveValue("fetch");
});

test("a server that offers OAuth can be switched to OAuth sign-in from the test result", async () => {
  actions.testMcpServerAction.mockResolvedValue({ check: { ...ok, status: "needs_auth", tools: [], oauthAvailable: true, message: "The server answered 401 and supports OAuth sign-in." } });
  const server = { name: "context7", transport: "http" as const, command: null, args: [], url: "https://mcp.context7.com/mcp/oauth", env: {}, headers: {}, tools: [], auth: "headers" as const };
  render(<McpServerForm initial={server} />);
  expect(screen.getByLabelText("Authentication")).toHaveValue("headers");
  fireEvent.click(screen.getByRole("button", { name: "Test server" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use OAuth sign-in" }));
  expect(screen.getByLabelText("Authentication")).toHaveValue("oauth");
});

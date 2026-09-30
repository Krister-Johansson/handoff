import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { McpSignIn } from "./mcp-sign-in";

vi.mock("@/app/library/mcp-oauth-actions", () => ({ signInMcpAction: vi.fn(), signOutMcpAction: vi.fn() }));

test("a server nobody signed in to offers sign-in and says runs need it", () => {
  render(<McpSignIn name="context7" status={{ connected: false }} />);
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.getByText(/runs that use context7 fail/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
});

test("a signed-in server shows when its token expires and can sign out or sign in again", () => {
  render(<McpSignIn name="context7" status={{ connected: true, expiresAt: "2026-10-01T12:00:00.000Z", refreshable: true, scope: "read" }} />);
  expect(screen.getByText("Signed in")).toBeInTheDocument();
  expect(screen.getByText(/refreshed when a run needs it/i)).toBeInTheDocument();
  expect(screen.getByText("read")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

test("the outcome of the last sign-in is shown", () => {
  const { rerender } = render(<McpSignIn name="context7" status={{ connected: false }} error="The user said no" />);
  expect(screen.getByText("The user said no")).toBeInTheDocument();
  rerender(<McpSignIn name="context7" status={{ connected: true }} signedIn />);
  expect(screen.getByText(/signed in to context7/i)).toBeInTheDocument();
});

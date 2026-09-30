import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { NewMcpServer } from "./new-mcp-server";

const actions = vi.hoisted(() => ({ saveMcpServer: vi.fn(), saveAgent: vi.fn(), testMcpServerAction: vi.fn(), addMcpFromUrlAction: vi.fn() }));
vi.mock("@/app/library/actions", () => actions);

test("adding from a URL suggests the name from the host", () => {
  render(<NewMcpServer />);
  fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "https://mcp.context7.com/mcp/oauth" } });
  expect(screen.getByLabelText("Name")).toHaveAttribute("placeholder", "context7");
});

test("a server that needs a key opens the manual form with the URL filled in", async () => {
  actions.addMcpFromUrlAction.mockResolvedValue({ manual: { name: "keyed", url: "https://keyed.example.com/mcp" }, message: "Add its API key as a header." });
  render(<NewMcpServer />);
  fireEvent.change(screen.getByLabelText("Server URL"), { target: { value: "https://keyed.example.com/mcp" } });
  fireEvent.click(screen.getByRole("button", { name: "Add server" }));
  await waitFor(() => expect(screen.getByText("Add its API key as a header.")).toBeInTheDocument());
  expect(screen.getByLabelText("URL")).toHaveValue("https://keyed.example.com/mcp");
  expect(screen.getByLabelText("Transport")).toHaveValue("http");
  expect(screen.getByLabelText("Name")).toHaveValue("keyed");
});

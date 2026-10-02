import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { WebMcpSetting } from "./webmcp-setting";

afterEach(() => {
  localStorage.clear();
  delete (document as { modelContext?: unknown }).modelContext;
});

test("the switch turns WebMCP off and on for this browser, on by default", () => {
  Object.defineProperty(document, "modelContext", { value: new EventTarget(), configurable: true });
  render(<WebMcpSetting />);
  const toggle = screen.getByRole("switch", { name: "Expose tools to browser agents (WebMCP)" });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  expect(toggle).not.toBeChecked();
  expect(localStorage.getItem("handoff.webmcp")).toBe("off");
  fireEvent.click(toggle);
  expect(localStorage.getItem("handoff.webmcp")).toBe("on");
  expect(screen.queryByText("Your browser has no WebMCP.")).not.toBeInTheDocument();
});

test("a browser without WebMCP is told so", () => {
  render(<WebMcpSetting />);
  expect(screen.getByText(/Your browser has no WebMCP\./)).toBeInTheDocument();
});

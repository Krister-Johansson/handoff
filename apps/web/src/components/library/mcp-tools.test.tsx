import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { McpTools } from "./mcp-tools";

const check = {
  status: "ok" as const,
  checkedAt: "2026-09-30T10:00:00Z",
  durationMs: 400,
  resources: 0,
  prompts: 0,
  tools: [
    {
      name: "resolve-library-id",
      description: "Resolves a package name to a library ID.",
      inputSchema: { type: "object", properties: { libraryName: { type: "string", description: "Library to look up" } }, required: ["libraryName"] },
    },
    { name: "query-docs", description: "Fetches documentation." },
  ],
};

test("a server's tools are listed with what they do and their parameters", () => {
  render(<McpTools check={check} allowed={[]} checkedLabel="Sep 30, 2026" />);
  expect(screen.getByText("2 tools")).toBeInTheDocument();
  expect(screen.getByText(/every tool is allowed in runs/i)).toBeInTheDocument();
  fireEvent.click(screen.getByText("resolve-library-id"));
  expect(screen.getByText("Resolves a package name to a library ID.", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByText("libraryName")).toBeInTheDocument();
  expect(screen.getByText("Library to look up")).toBeInTheDocument();
});

test("with allowed tools, each tool says whether runs may use it", () => {
  render(<McpTools check={check} allowed={["query-docs"]} checkedLabel="Sep 30, 2026" />);
  expect(screen.getByText("resolve-library-id").closest("summary")).toHaveTextContent("Not allowed");
  expect(screen.getByText("query-docs").closest("summary")).toHaveTextContent("Allowed");
});

test("a server that was never checked asks for a test", () => {
  render(<McpTools check={null} allowed={[]} />);
  expect(screen.getByText(/test the server to list its tools/i)).toBeInTheDocument();
});

import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import type { ToolCallView } from "@/lib/assistant/port";
import { ToolRows } from "./tool-rows";

const calls: ToolCallView[] = [
  { id: "u1", name: "get_run", title: "Show a run", summary: "Show run 7f3a1b2c", status: "done", result: '{"id":"7f3a1b2c"}' },
  { id: "u2", name: "list_plan", title: "Show the plan", summary: "Show the plan of handoff", status: "done", result: '{"epics":[]}' },
];

test("a call drawn as a card keeps its row, which no longer opens to the raw result", () => {
  render(<ToolRows calls={calls} carded={new Set(["u1"])} />);
  const card = screen.getByRole("group", { name: "Show a run" });
  expect(card).toHaveTextContent("Show run 7f3a1b2c");
  expect(card).not.toHaveTextContent('{"id":"7f3a1b2c"}');
  // A plain row: nothing to open.
  expect(card.querySelector("details")).toBeNull();
  expect(within(card).getByText("Show a run")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Show the plan" })).toHaveTextContent('{"epics":[]}');
});

import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { TerminalOutput } from "./terminal-output";

const E = "\u001b";

test("terminal output shows coloured text without escape codes", () => {
  const { container } = render(<TerminalOutput text={`${E}[32m✓${E}[39m src/a.test.ts\n${E}[31mFAIL${E}[39m b`} />);
  expect(container.textContent).not.toContain("\u001b");
  expect(container.textContent).not.toContain("[32m");
  expect(screen.getByText("✓")).toHaveAttribute("data-fg", "green");
  expect(screen.getByText("FAIL")).toHaveAttribute("data-fg", "red");
});

test("the copy button copies the text without escape codes", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<TerminalOutput text={`${E}[32mok${E}[39m done`} label="npm test output" />);
  fireEvent.click(screen.getByRole("button", { name: "Copy npm test output" }));
  expect(writeText).toHaveBeenCalledWith("ok done");
});

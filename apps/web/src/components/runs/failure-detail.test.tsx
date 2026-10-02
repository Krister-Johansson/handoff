import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { FailureDetail } from "./failure-detail";

test("a Claude step that ran out of turns shows how it ended, its turns, its cost and its last message", () => {
  const error = {
    code: "cli_error_max_turns",
    message: "claude ended with error_max_turns",
    detail: { subtype: "error_max_turns", turns: 64, costUsd: 1.234, lastMessage: "Committed the parser; the formatter is not done.", exitCode: 1, stderrTail: "" },
  };
  render(<FailureDetail error={error} />);
  expect(screen.getByText("error_max_turns")).toBeInTheDocument();
  expect(screen.getByText("64 turns")).toBeInTheDocument();
  expect(screen.getByText("$1.23")).toBeInTheDocument();
  expect(screen.getByText("Committed the parser; the formatter is not done.")).toBeInTheDocument();
});

test("a step failed for files outside the plan lists the files", () => {
  render(<FailureDetail error={{ code: "paths_outside_plan", message: "files outside the plan: notes.txt", detail: { files: ["notes.txt", "pnpm-lock.yaml"] } }} />);
  expect(screen.getByText("notes.txt")).toBeInTheDocument();
  expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
});

test("an error without such detail shows nothing more", () => {
  const { container } = render(<FailureDetail error={{ code: "TESTS_FAILED", message: "2 of 41 tests failed" }} />);
  expect(container).toBeEmptyDOMElement();
});

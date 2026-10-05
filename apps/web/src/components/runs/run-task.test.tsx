import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { taskParts } from "@/lib/run-task";
import { RunTaskBody } from "./run-task";

test("a task's first line is its title and the rest, trimmed, its body", () => {
  expect(taskParts("Add tags")).toEqual({ title: "Add tags", body: "" });
  expect(taskParts("repo: Workspace skeleton\n\nCreate the pnpm workspace.\nAdds package.json.\n")).toEqual({
    title: "repo: Workspace skeleton",
    body: "Create the pnpm workspace.\nAdds package.json.",
  });
});

test("a short body shows whole, with no Show more", () => {
  render(<RunTaskBody body="Create the pnpm workspace." />);
  expect(screen.getByText("Create the pnpm workspace.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
});

test("a long body is clamped until Show more, and Show less clamps it again", () => {
  const body = "Create the pnpm workspace that later tasks build on. ".repeat(12).trim();
  render(<RunTaskBody body={body} />);
  const text = screen.getByText(body);
  expect(text).toHaveClass("line-clamp-3");
  fireEvent.click(screen.getByRole("button", { name: "Show more" }));
  expect(text).not.toHaveClass("line-clamp-3");
  fireEvent.click(screen.getByRole("button", { name: "Show less" }));
  expect(text).toHaveClass("line-clamp-3");
});

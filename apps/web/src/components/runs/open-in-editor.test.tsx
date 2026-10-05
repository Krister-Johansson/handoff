import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { writeCodeEditor } from "@/lib/code-editor";
import type { WorktreeState } from "@/lib/worktree-state";
import { OpenInEditor } from "./open-in-editor";

const PATH = "/Users/krister/.handoff/worktrees/7f3a2c1e-4b0d-4c51-9a8e-2d6f1b3c9e07";
const SHOWN = "~/.handoff/worktrees/7f3a2c1e-4b0d-4c51-9a8e-2d6f1b3c9e07";

const show = (worktree: WorktreeState) =>
  render(
    <TooltipProvider>
      <OpenInEditor worktree={worktree} />
    </TooltipProvider>,
  );

async function tooltipOf(control: HTMLElement) {
  fireEvent.focus(control);
  return screen.findByRole("tooltip");
}

test("a run's worktree on disk opens in VS Code, and the tooltip names the folder", async () => {
  show({ state: "open", path: PATH, shown: SHOWN, running: false });
  const link = screen.getByRole("link", { name: "Open in VS Code" });
  expect(link).toHaveAttribute("href", `vscode://file${PATH}`);
  const tip = await tooltipOf(link);
  expect(tip).toHaveTextContent("Opens the run's worktree");
  expect(tip).toHaveTextContent(SHOWN);
  expect(tip).not.toHaveTextContent("A step is working in this folder.");
});

test("while a step runs, the tooltip says that changes go into the run", async () => {
  show({ state: "open", path: PATH, shown: SHOWN, running: true });
  const tip = await tooltipOf(screen.getByRole("link", { name: "Open in VS Code" }));
  expect(tip).toHaveTextContent("A step is working in this folder. What you change here goes into the run.");
});

test.each<[string, WorktreeState, string[]]>([
  ["not made yet", { state: "not-created" }, ["The run makes its worktree when its first step starts."]],
  ["released with a PR", { state: "released", prNumber: 88 }, ["The worktree was removed when the run finished.", "Its changes are in PR #88."]],
  ["released without a PR", { state: "released", prNumber: null }, ["The worktree was removed when the run finished."]],
  ["removed by gc", { state: "removed-by-gc" }, ["handoff gc removed the worktree. Repair the run to make it again."]],
  ["missing on disk", { state: "missing", shown: SHOWN }, ["The worktree is not on this machine:", SHOWN]],
])("with the worktree %s the button is disabled and its tooltip says why", async (_, worktree, lines) => {
  show(worktree);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  const button = screen.getByRole("button", { name: "Open in VS Code" });
  expect(button).toHaveAttribute("aria-disabled", "true");
  const tip = await tooltipOf(button);
  for (const line of lines) expect(tip).toHaveTextContent(line);
  if (worktree.state === "released" && worktree.prNumber === null) expect(tip).not.toHaveTextContent("Its changes are in");
});

test("the Code editor setting picks the link's scheme and the button's name", () => {
  writeCodeEditor("vscode-insiders");
  show({ state: "open", path: PATH, shown: SHOWN, running: false });
  expect(screen.getByRole("link", { name: "Open in VS Code Insiders" })).toHaveAttribute("href", `vscode-insiders://file${PATH}`);
  act(() => writeCodeEditor("vscode"));
  expect(screen.getByRole("link", { name: "Open in VS Code" })).toHaveAttribute("href", `vscode://file${PATH}`);
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { RunAgainButton } from "./run-again-button";

const runAgainAction = vi.hoisted(() => vi.fn(async () => ({ ok: false, error: "The run is still running." })));
vi.mock("@/app/projects/actions", () => ({ runAgainAction }));
beforeEach(() => runAgainAction.mockClear());

/** The choices the Run again button offers, in order. */
async function choices() {
  fireEvent.click(screen.getByRole("button", { name: "Run again" }));
  const dialog = await screen.findByRole("dialog", { name: "Where the run starts" });
  return within(dialog).getAllByRole("button");
}

const sent = () => {
  const form = (runAgainAction.mock.calls[0] as unknown[])[1] as FormData;
  return { runId: form.get("runId"), from: form.get("from") };
};

test("Run again asks where to start, the branch first when the run committed work, and shows a refusal", async () => {
  render(<RunAgainButton runId="r1" branch="handoff/add-slugify-1a2b3c4d" hasWork />);
  const [first, second] = await choices();
  expect(first).toHaveAccessibleName(expect.stringMatching(/^Continue from the branch/));
  expect(first).toHaveTextContent("handoff/add-slugify-1a2b3c4d");
  expect(second).toHaveAccessibleName(expect.stringMatching(/^Start from scratch/));
  fireEvent.click(first!);
  await waitFor(() => expect(runAgainAction).toHaveBeenCalledTimes(1));
  expect(sent()).toEqual({ runId: "r1", from: "branch" });
  expect(await screen.findByText("The run is still running.")).toBeInTheDocument();
});

test("Run again offers scratch first when the run committed nothing, and sends the choice made", async () => {
  render(<RunAgainButton runId="r1" branch="handoff/add-slugify-1a2b3c4d" hasWork={false} />);
  const [first, second] = await choices();
  expect(first).toHaveAccessibleName(expect.stringMatching(/^Start from scratch/));
  fireEvent.click(second!);
  await waitFor(() => expect(runAgainAction).toHaveBeenCalledTimes(1));
  expect(sent()).toEqual({ runId: "r1", from: "branch" });
});

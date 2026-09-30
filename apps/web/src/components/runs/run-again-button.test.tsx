import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { RunAgainButton } from "./run-again-button";

const runAgainAction = vi.hoisted(() => vi.fn(async () => ({ ok: false, error: "The run is still running." })));
vi.mock("@/app/projects/actions", () => ({ runAgainAction }));

test("Run again submits the run id and shows a refusal", async () => {
  render(<RunAgainButton runId="r1" />);
  fireEvent.click(screen.getByRole("button", { name: "Run again" }));
  await waitFor(() => expect(runAgainAction).toHaveBeenCalledTimes(1));
  const form = (runAgainAction.mock.calls[0] as unknown[])[1] as FormData;
  expect(form.get("runId")).toBe("r1");
  expect(await screen.findByText("The run is still running.")).toBeInTheDocument();
});

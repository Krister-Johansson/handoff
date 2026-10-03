import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { CapacityPopover } from "./capacity-popover";

const actions = vi.hoisted(() => ({ setCapacityAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })) }));
vi.mock("@/app/projects/actions", () => actions);

beforeEach(() => actions.setCapacityAction.mockClear());

const open = () => {
  render(
    <CapacityPopover projectId="p1" capacity={6}>
      <button type="button">Change</button>
    </CapacityPopover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  return screen.getByRole("dialog", { name: "Capacity" });
};

test("the capacity takes 1 to 24 hours and says how a 12h estimate reads", async () => {
  const dialog = open();
  const hours = within(dialog).getByLabelText("Hours a day");
  expect(hours).toHaveValue(6);
  expect(dialog).toHaveTextContent("1d is 6h");
  expect(dialog).toHaveTextContent("Manual estimates stay in hours. A 12h estimate reads 2d at 6h a day.");

  fireEvent.change(hours, { target: { value: "8" } });
  expect(dialog).toHaveTextContent("1d is 8h");
  expect(dialog).toHaveTextContent("Manual estimates stay in hours. A 12h estimate reads 2d at 6h a day and 1.5d at 8h a day.");

  for (const value of ["25", "0.5", ""]) {
    fireEvent.change(hours, { target: { value } });
    expect(within(dialog).getByText("Hours a day is a number from 1 to 24.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  }

  fireEvent.change(hours, { target: { value: "7.5" } });
  expect(dialog).toHaveTextContent("1d is 7h 30m");
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.setCapacityAction).toHaveBeenCalledWith({ projectId: "p1", hours: 7.5 }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Capacity" })).not.toBeInTheDocument());
});

test("a refused save keeps the popover open with the reason, and Cancel closes it without saving", async () => {
  actions.setCapacityAction.mockResolvedValueOnce({ ok: false, error: "The project no longer exists." });
  const dialog = open();
  fireEvent.change(within(dialog).getByLabelText("Hours a day"), { target: { value: "8" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(await within(dialog).findByText("The project no longer exists.")).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Capacity" })).toBeInTheDocument();

  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Capacity" })).not.toBeInTheDocument());
  expect(actions.setCapacityAction).toHaveBeenCalledTimes(1);
});

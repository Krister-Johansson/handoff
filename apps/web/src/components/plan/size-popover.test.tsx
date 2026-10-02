import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { PlanTask } from "@/server/plan";
import { Sizing, type SizingControl } from "./plan-context";
import { SizeChip } from "./size-chip";
import { sizingOf, task } from "./testing/plan-fixtures";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const actions = vi.hoisted(() => ({ setSizeAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })) }));
vi.mock("@/app/projects/actions", () => actions);

afterEach(() => vi.clearAllMocks());

function open(t: PlanTask, sizing: SizingControl = sizingOf()) {
  render(
    <Sizing value={sizing}>
      <SizeChip task={t} />
    </Sizing>,
  );
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`#${t.number}$`) }));
  return screen.getByRole("dialog", { name: `Size and estimate of #${t.number}` });
}

test("picking a size saves it at once", async () => {
  const popover = open(task(146, "R6 Restyle the list view", "Shaping"));
  const sizes = within(popover).getByRole("group", { name: "Size" });
  expect(within(sizes).getAllByRole("button").map((b) => b.textContent)).toEqual(["S~25m", "M~50m", "L~2h default"]);
  expect(within(sizes).getByRole("button", { name: /^M/ })).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(within(sizes).getByRole("button", { name: /^M/ }));
  await waitFor(() => expect(actions.setSizeAction).toHaveBeenCalledWith({ projectId: "p1", issue: 146, size: "M" }));
  await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(actions.setSizeAction).toHaveBeenCalledTimes(1);
});

test("a typed estimate shows its hours and the forecast it overrides, and a typo shows the hint", async () => {
  const dated = task(149, "R9 Restyle dialogs", "Shaping", { size: "L", start: "2026-10-04", target: "2026-10-04" });
  const popover = open(dated);
  expect(within(popover).getByText("Default for L: 2h. 3 finished L runs so far; the forecast starts at 5.")).toBeInTheDocument();
  const field = within(popover).getByRole("textbox", { name: "Manual estimate" });
  expect(field).toHaveAttribute("placeholder", "5h or 1.5d");

  fireEvent.change(field, { target: { value: "1.5d" } });
  expect(within(popover).getByText("9 hours. Overrides the L default of 2h. Target moves to Oct 5.")).toBeInTheDocument();
  fireEvent.change(field, { target: { value: "2h" } });
  expect(within(popover).getByText("2 hours. Overrides the L default of 2h. Target stays Oct 4.")).toBeInTheDocument();

  fireEvent.change(field, { target: { value: "soon" } });
  expect(within(popover).getByText("Use hours or days, like 3h or 2d.")).toBeInTheDocument();
  expect(field).toHaveAttribute("aria-invalid", "true");
  fireEvent.keyDown(field, { key: "Enter" });
  expect(actions.setSizeAction).not.toHaveBeenCalled();

  fireEvent.change(field, { target: { value: "1.5d" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(actions.setSizeAction).toHaveBeenCalledWith({ projectId: "p1", issue: 149, estimate: 9 }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("Use M writes the planner's proposal and Use the forecast clears the estimate", async () => {
  const proposed = task(147, "R7 Restyle the dashboard", "Shaping", { proposal: { size: "M", runId: "r9", steps: 6, paths: 4 } });
  const popover = open(proposed);
  expect(within(popover).getByRole("button", { name: /^M/ })).toHaveAttribute("title", "Proposed by the planner");
  expect(within(popover).getByRole("button", { name: /^M/ })).toHaveAttribute("aria-pressed", "false");
  expect(within(popover).getByText("The planner proposed M from its plan: 6 steps, 4 owned paths.")).toBeInTheDocument();
  expect(within(popover).getByRole("button", { name: "Use the forecast" })).toBeDisabled();
  fireEvent.click(within(popover).getByRole("button", { name: "Use M" }));
  await waitFor(() => expect(actions.setSizeAction).toHaveBeenCalledWith({ projectId: "p1", issue: 147, size: "M" }));
  cleanup();

  // A person's Size hides the proposal, and a manual estimate can be cleared to use the forecast again.
  const estimated = open(task(143, "R3 Restyle the sidebar", "Ready", { size: "L", estimate: 9, proposal: { size: "M", runId: "r9", steps: 6, paths: 4 } }));
  expect(within(estimated).queryByRole("button", { name: "Use M" })).not.toBeInTheDocument();
  expect(within(estimated).getByRole("button", { name: /^L/ })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(estimated).getByRole("button", { name: "Use the forecast" }));
  await waitFor(() => expect(actions.setSizeAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 143, estimate: null }));

  // A quick pick saves at once in hours, a day being the capacity.
  cleanup();
  fireEvent.click(within(open(task(144, "R4 Restyle the content", "Shaping", { size: "S" }))).getByRole("button", { name: "1d" }));
  await waitFor(() => expect(actions.setSizeAction).toHaveBeenLastCalledWith({ projectId: "p1", issue: 144, estimate: 6 }));
});

test("a refused size reopens the popover with GitHub's answer", async () => {
  actions.setSizeAction.mockResolvedValueOnce({ ok: false, error: "GitHub Project #5 has no Size and no Estimate field." });
  const popover = open(task(146, "R6 Restyle the list view", "Shaping", { size: "S" }));
  expect(within(popover).getByText("Forecast from 18 finished S runs in todooverkill: usually 25m, about 7m of it waiting on you.")).toBeInTheDocument();
  expect(within(popover).getByRole("button", { name: /^S/ })).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(within(popover).getByRole("button", { name: /^L/ }));
  const again = await screen.findByRole("dialog", { name: "Size and estimate of #146" });
  expect(await within(again).findByText("GitHub Project #5 has no Size and no Estimate field.")).toBeInTheDocument();
  expect(router.refresh).not.toHaveBeenCalled();
});

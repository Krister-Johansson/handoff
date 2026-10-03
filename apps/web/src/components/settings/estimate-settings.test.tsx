import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Forecasts } from "@/lib/plan/forecast";
import { EstimateSettings } from "./estimate-settings";

const actions = vi.hoisted(() => ({
  setCapacityAction: vi.fn(async () => ({ ok: true })),
  setPlanBudgetAction: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
}));
vi.mock("@/app/projects/actions", () => actions);

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockClear();
});

const forecasts: Forecasts = {
  S: { size: "S", source: "runs", minutes: 25, parts: { agent: 15, queue: 3, waiting: 7 }, costUsd: 0.4, runs: 18, measuredMinutes: 25 },
  M: { size: "M", source: "runs", minutes: 50, parts: { agent: 30, queue: 5, waiting: 15 }, costUsd: 0.9, runs: 12, measuredMinutes: 50 },
  L: { size: "L", source: "default", minutes: 120, parts: null, costUsd: null, runs: 3, measuredMinutes: 110 },
};

const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

test("the forecasts table shows each size's usual time, parts, cost and runs, and a default with its measured median", () => {
  render(<EstimateSettings mode="timeline" projectId="p1" capacity={6} forecasts={forecasts} planBudget={null} />);
  const section = screen.getByRole("region", { name: "Forecasts from finished runs" });
  expect(section).toHaveTextContent("A size with fewer than 5 runs uses its default.");
  expect(within(section).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Size", "Usually", "Agent", "Queue", "Waiting on you", "Cost", "Runs"]);
  const [, s, m, l] = within(section).getAllByRole("row");
  expect(cells(s!)).toEqual(["S", "25m", "15m", "3m", "7m", "$0.40", "18"]);
  expect(cells(m!)).toEqual(["M", "50m", "30m", "5m", "15m", "$0.90", "12"]);
  expect(cells(l!)).toEqual(["L", "2h Default", "Measured 1h 50m over 3 runs; the forecast starts at 5.", "3"]);
  expect(section).toHaveTextContent("Defaults: S 30m, M 1h, L 2h.");
});

test("a size with one run or none says so", () => {
  const few: Forecasts = {
    ...forecasts,
    S: { ...forecasts.L, size: "S", minutes: 30, runs: 0, measuredMinutes: null },
    M: { ...forecasts.L, size: "M", minutes: 60, runs: 1, measuredMinutes: 40 },
  };
  render(<EstimateSettings mode="timeline" projectId="p1" capacity={6} forecasts={few} planBudget={null} />);
  const [, s, m] = within(screen.getByRole("region", { name: "Forecasts from finished runs" })).getAllByRole("row");
  expect(cells(s!)).toEqual(["S", "30m Default", "No S runs yet; the forecast starts at 5.", "0"]);
  expect(cells(m!)).toEqual(["M", "1h Default", "Measured 40m over 1 run; the forecast starts at 5.", "1"]);
});

test("the capacity reads in hours a day and Change opens its popover", () => {
  render(<EstimateSettings mode="timeline" projectId="p1" capacity={7.5} forecasts={forecasts} planBudget={null} />);
  const section = screen.getByRole("region", { name: "Capacity" });
  expect(section).toHaveTextContent("7h 30m a day");
  expect(section).toHaveTextContent("Every day counts, weekends too.");
  fireEvent.click(within(section).getByRole("button", { name: "Change" }));
  expect(within(screen.getByRole("dialog", { name: "Capacity" })).getByLabelText("Hours a day")).toHaveValue(7.5);
});

test("the plan budget shows the defaults while empty and saves files and steps as typed", async () => {
  const { unmount } = render(<EstimateSettings mode="timeline" projectId="p1" capacity={6} forecasts={forecasts} planBudget={null} />);
  let section = screen.getByRole("region", { name: "Plan budget" });
  expect(within(section).getByLabelText("Files")).toHaveAttribute("placeholder", "15");
  expect(within(section).getByLabelText("Steps")).toHaveAttribute("placeholder", "12");
  expect(section).toHaveTextContent("Empty means 15 files and 12 steps.");
  unmount();

  actions.setPlanBudgetAction.mockResolvedValueOnce({ ok: false, error: "The project no longer exists." });
  render(<EstimateSettings mode="timeline" projectId="p1" capacity={6} forecasts={forecasts} planBudget={{ files: 8, steps: 6 }} />);
  section = screen.getByRole("region", { name: "Plan budget" });
  expect(within(section).getByLabelText("Files")).toHaveValue(8);
  fireEvent.change(within(section).getByLabelText("Steps"), { target: { value: "5" } });
  fireEvent.click(within(section).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.setPlanBudgetAction).toHaveBeenCalledWith({ projectId: "p1", files: "8", steps: "5" }));
  expect(await within(section).findByText("The project no longer exists.")).toBeInTheDocument();

  fireEvent.change(within(section).getByLabelText("Steps"), { target: { value: "" } });
  fireEvent.click(within(section).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(actions.setPlanBudgetAction).toHaveBeenLastCalledWith({ projectId: "p1", files: "8", steps: "" }));
  await waitFor(() => expect(within(section).queryByText("The project no longer exists.")).not.toBeInTheDocument());
});

test("a Flow project's section has the plan budget only: no capacity in hours and no forecasts in minutes", () => {
  render(<EstimateSettings mode="flow" projectId="p1" planBudget={{ files: 8, steps: 6 }} />);
  expect(screen.queryByRole("region", { name: "Capacity" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Forecasts from finished runs" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Change" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Plan budget" })).getByLabelText("Files")).toHaveValue(8);
});

test("a Timeline project's section keeps the capacity, the forecasts and the plan budget", () => {
  render(<EstimateSettings mode="timeline" projectId="p1" capacity={6} forecasts={forecasts} planBudget={null} />);
  expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["Capacity", "Forecasts from finished runs", "Plan budget"]);
});

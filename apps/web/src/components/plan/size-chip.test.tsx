import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Sizing } from "./plan-context";
import { SizeChip } from "./size-chip";
import { sizingOf, task } from "./testing/plan-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/projects/actions", () => ({ setSizeAction: vi.fn() }));

const proposal = (size: "S" | "M" | "L") => ({ size, runId: "r9", steps: 6, paths: 4 });

test("the chip shows a forecast, a dotted default, a dashed proposal, a pinned estimate and Size when there is none", () => {
  render(
    <Sizing value={sizingOf()}>
      <SizeChip task={task(141, "R1 Redesign tokens", "Done", { size: "S" })} />
      <SizeChip task={task(148, "R8 Restyle the task page", "Shaping", { size: "L" })} />
      <SizeChip task={task(147, "R7 Restyle the dashboard", "Shaping", { proposal: proposal("M") })} />
      <SizeChip task={task(143, "R3 Restyle the sidebar", "Ready", { size: "L", estimate: 9 })} />
      <SizeChip task={task(150, "R10 Restyle settings", "Shaping", { estimate: 7 })} />
      <SizeChip task={task(152, "Document the workflow", "Shaping")} />
    </Sizing>,
  );

  const forecast = screen.getByRole("button", { name: "Size S, forecast 25m. Change the size or estimate of #141" });
  expect(forecast).toHaveTextContent("S~25m");
  expect(forecast).toHaveAttribute("title", "Forecast for S: usually 25m, from 18 runs");

  const fallback = screen.getByRole("button", { name: "Size L, default forecast 2h. Change the size or estimate of #148" });
  expect(fallback).toHaveTextContent("L~2h");
  expect(fallback).toHaveAttribute("title", "Default for L: 2h. 3 L runs so far; 5 needed");

  const proposed = screen.getByRole("button", { name: "Size M, proposed by the planner, forecast 50m. Change the size or estimate of #147" });
  expect(proposed).toHaveTextContent("M~50m");
  expect(proposed).toHaveAttribute("title", "Proposed by the planner. Forecast for M: usually 50m, from 12 runs");

  const pinned = screen.getByRole("button", { name: "Size L, manual estimate 1.5d. Change the size or estimate of #143" });
  expect(pinned).toHaveTextContent("L1.5d");
  expect(pinned).toHaveTextContent(/^L1\.5d$/);
  expect(pinned).toHaveAttribute("title", "Manual estimate 9 hours; overrides the L default of 2h");

  const unsized = screen.getByRole("button", { name: "Manual estimate 1d 1h. Change the size or estimate of #150" });
  expect(unsized).toHaveAttribute("title", "Manual estimate 7 hours");

  const none = screen.getByRole("button", { name: "Set a size for #152" });
  expect(none).toHaveTextContent("Size");
  expect(within(none).queryByText(/~/)).not.toBeInTheDocument();
});

test("without the Plan page's forecasts the chip is not shown", () => {
  render(<SizeChip task={task(141, "R1 Redesign tokens", "Done", { size: "S" })} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

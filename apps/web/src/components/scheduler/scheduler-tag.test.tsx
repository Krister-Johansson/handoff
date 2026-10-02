import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { StartedByScheduler } from "./scheduler-tag";

test("a run the scheduler started says so, with its place in the order; others say nothing", () => {
  const { container, rerender } = render(<StartedByScheduler startedBy="scheduler" place={2} />);
  expect(screen.getByText("Scheduler").closest("[title]")).toHaveAttribute("title", "Started by the scheduler, 2nd in order");
  rerender(<StartedByScheduler startedBy="dashboard" place={undefined} />);
  expect(container).toBeEmptyDOMElement();
});

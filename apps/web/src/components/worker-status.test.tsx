import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WorkerStatusView } from "./worker-status-view";

test("shows the worker as online with a count", () => {
  render(<WorkerStatusView live={2} queuedRuns={0} />);
  expect(screen.getByText("2 workers online")).toBeInTheDocument();
});

test("warns when runs are queued and no worker is online", () => {
  render(<WorkerStatusView live={0} queuedRuns={3} />);
  expect(screen.getByText("No worker running")).toBeInTheDocument();
  expect(screen.getByTitle(/3 queued runs are waiting/)).toBeInTheDocument();
});

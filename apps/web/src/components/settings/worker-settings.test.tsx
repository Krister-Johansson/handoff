import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { WorkerSettings } from "./worker-settings";

const now = new Date("2026-09-30T17:42:14Z");

test("an online worker shows its host, last heartbeat and how many nodes of each kind it runs at once", () => {
  render(
    <WorkerSettings
      now={now}
      queuedRuns={0}
      workers={[{ id: "w1", hostname: "mbp-krister", caps: { cli: 1, shell: 4 }, startedAt: new Date("2026-09-30T09:00:00Z"), heartbeatAt: new Date("2026-09-30T17:42:10Z") }]}
    />,
  );
  expect(screen.getByText("1 worker online")).toBeInTheDocument();
  expect(screen.getByText("mbp-krister")).toBeInTheDocument();
  expect(screen.getByText("heartbeat 4 s ago")).toBeInTheDocument();
  expect(screen.getByText("cli 1, shell 4")).toBeInTheDocument();
});

test("with no worker it says so, how many runs wait, and how to start one", () => {
  render(<WorkerSettings now={now} queuedRuns={2} workers={[]} />);
  expect(screen.getByText("No worker running")).toBeInTheDocument();
  expect(screen.getByText("2 queued runs are waiting.")).toBeInTheDocument();
  expect(screen.getByText("pnpm dev:worker")).toBeInTheDocument();
});

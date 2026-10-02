import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { SchedulerEvents } from "./scheduler-events";
import { NOW, PROJECT } from "./testing/fixtures";

const at = (iso: string) => new Date(iso);

test("All events opens a sheet with the events newest first, by day, each with its time", async () => {
  const events = [
    { id: 5, type: "scheduler.held", text: "Held: run 3b9e21c4 waits for your review at human_gate-1", at: at("2026-10-02T18:31:00Z") },
    { id: 4, type: "scheduler.run_started", text: "Started run 3b9e21c4 on #141, 1st in order", at: at("2026-10-02T18:05:00Z") },
    { id: 3, type: "scheduler.paused", text: 'Paused by a person from the dashboard: "Stop for the night"', at: at("2026-10-01T23:40:00Z") },
    { id: 2, type: "scheduler.paused", text: "Paused itself: 3 starts failed in a row", at: at("2026-09-30T19:20:00Z") },
    { id: 1, type: "scheduler.started", text: "Turned on from the assistant: up to 1 run, Project order, graph master", at: at("2026-09-30T19:16:00Z") },
  ];
  render(<SchedulerEvents project={PROJECT} events={events} now={NOW} />);

  fireEvent.click(screen.getByRole("button", { name: "All events" }));
  const sheet = await screen.findByRole("dialog", { name: "Scheduler events" });
  expect(within(sheet).getByText("todooverkill, the last 50, newest first.")).toBeInTheDocument();
  const days = within(sheet).getAllByRole("list");
  expect(days.map((d) => d.getAttribute("aria-label"))).toEqual(["Today", "Yesterday", "Sep 30"]);
  expect(within(days[0]!).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "18:31Held: run 3b9e21c4 waits for your review at human_gate-1",
    "18:05Started run 3b9e21c4 on #141, 1st in order",
  ]);
  expect(within(days[2]!).getAllByRole("listitem")).toHaveLength(2);
  expect(within(days[0]!).getAllByRole("listitem")[0]!.querySelector("time")).toHaveAttribute("datetime", "2026-10-02T18:31:00.000Z");
});

import { expect, test } from "vitest";
import { layoutFlow } from "../lib/plan/flow";
import { epic, flowOf, planView, story, task } from "../components/plan/testing/plan-fixtures";
import { nextPlaces, type SchedulerCard } from "./scheduler-card";

test("in a Flow project the Next places come from the flow's order, counting blocked tasks", () => {
  const view = planView([
    epic(12, "Project management", [
      story(41, "Shaping with the assistant", 12, [
        task(55, "Shaping tools", "Running"),
        task(57, "Add the migration", "Ready", { blockedBy: [55] }),
        task(58, "Plan page tree and board", "Ready"),
        task(61, "Story page", "Ready"),
        task(62, "Size chip", "Ready"),
        task(64, "Board filters", "Shaping"),
      ]),
    ]),
  ]);
  // The scheduler starts #58 first, since #57 waits for #55.
  const card = { next: [{ number: 58 }, { number: 61 }, { number: 62 }] } as SchedulerCard;
  expect(nextPlaces(card)).toEqual({ 58: 1, 61: 2, 62: 3 });

  // The Flow numbers every Ready task in its place, so the tree, the Flow and a drag agree; Shaping tasks have none.
  expect(nextPlaces(card, layoutFlow(flowOf(view)))).toEqual({ 57: 1, 58: 2, 61: 3, 62: 4 });
});

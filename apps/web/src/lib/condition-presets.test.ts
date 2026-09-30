import { expect, test } from "vitest";
import { ConditionSchema } from "@handoff/core";
import { CONDITION_PRESETS } from "./condition-presets";

test("every condition preset is a valid condition", () => {
  for (const preset of CONDITION_PRESETS) expect(ConditionSchema.safeParse(preset.condition).success, preset.label).toBe(true);
});

test("presets cover the loop graph's routing", () => {
  expect(CONDITION_PRESETS.map((p) => p.label)).toEqual(
    expect.arrayContaining(["Coder finished", "Coder asked a question", "Tests failed", "Review requested changes", "CI failed or changes requested", "CI green and not blocked"]),
  );
});

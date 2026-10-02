import { expect, test } from "vitest";
import { parseEstimate } from "./duration";

const REFUSED = { error: "Use hours or days, like 3h or 2d." };

test("3h, 2d and 1.5d parse to hours at the capacity and other text is refused", () => {
  expect(parseEstimate("3h", 6)).toEqual({ hours: 3 });
  expect(parseEstimate("2d", 6)).toEqual({ hours: 12 });
  expect(parseEstimate("1.5d", 6)).toEqual({ hours: 9 });
  expect(parseEstimate("1.5d", 8)).toEqual({ hours: 12 });
  expect(parseEstimate(" 5H ", 6)).toEqual({ hours: 5 });
  expect(parseEstimate("0h", 6)).toEqual({ hours: 0 });

  for (const text of ["", "3", "three hours", "2w", "h", "-2h", "1.5.2d", "3h 2d"]) expect(parseEstimate(text, 6)).toEqual(REFUSED);
});

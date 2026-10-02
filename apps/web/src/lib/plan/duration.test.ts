import { expect, test } from "vitest";
import { formatDuration, parseEstimate } from "./duration";

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

test("7 hours at 6 a day reads 1d 1h and 50 minutes reads 50m", () => {
  expect(formatDuration(7, 6)).toBe("1d 1h");
  expect(formatDuration(50 / 60, 6)).toBe("50m");
  // Under a day: hours and minutes.
  expect(formatDuration(2.5, 6)).toBe("2h 30m");
  expect(formatDuration(2, 6)).toBe("2h");
  // From a day: days, a half day as a decimal, and hours left over.
  expect(formatDuration(6, 6)).toBe("1d");
  expect(formatDuration(9, 6)).toBe("1.5d");
  expect(formatDuration(12, 6)).toBe("2d");
  expect(formatDuration(12, 8)).toBe("1.5d");
  expect(formatDuration(16, 6)).toBe("2d 4h");
});

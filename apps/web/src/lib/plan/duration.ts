const ESTIMATE = /^(\d+(?:\.\d+)?)([hd])$/;

/**
 * A typed estimate in hours: "3h" is 3 hours and "2d" is two days of the project's capacity in hours a day.
 * Anything else answers with a sentence that says what to type. 0 is an estimate of nothing, which clears it.
 */
export function parseEstimate(text: string, capacity: number): { hours: number } | { error: string } {
  const match = ESTIMATE.exec(text.trim().toLowerCase());
  if (!match) return { error: "Use hours or days, like 3h or 2d." };
  const value = Number(match[1]);
  return { hours: match[2] === "d" ? value * capacity : value };
}

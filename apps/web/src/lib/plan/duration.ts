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

/**
 * A duration as the plan writes it: under a day of capacity in hours and minutes ("50m", "2h 30m"); from a
 * day in days, a whole or half number of days as a decimal ("1d", "1.5d") and otherwise with the hours left ("1d 1h").
 */
export function formatDuration(hours: number, capacity: number): string {
  if (hours < capacity) {
    const minutes = Math.round(hours * 60);
    const text = [Math.floor(minutes / 60) && `${Math.floor(minutes / 60)}h`, minutes % 60 && `${minutes % 60}m`].filter(Boolean).join(" ");
    return text || "0m";
  }
  const halves = (hours / capacity) * 2;
  if (Math.abs(halves - Math.round(halves)) < 1e-9) return `${Math.round(halves) / 2}d`;
  let days = Math.floor(hours / capacity);
  let rest = Math.round(hours - days * capacity);
  if (rest >= capacity) [days, rest] = [days + 1, 0];
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

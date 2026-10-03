import type { PlanSize } from "@handoff/github";
import { formatDuration } from "./duration";
import { durationOf, FORECAST_MIN_RUNS, type Forecast, type Forecasts } from "./forecast";

/** What a size chip needs of a task: its Size, its manual estimate in hours, and the planner's proposal. */
export type SizedTask = { number: number; size?: PlanSize | undefined; estimate?: number | undefined; proposal?: { size: PlanSize } | null | undefined };

/** The sizes in order; the client keeps its own copy so the GitHub package stays on the server. */
export const SIZES: readonly PlanSize[] = ["S", "M", "L"];

/** A change to a task's Size or manual estimate in hours: a value sets it, null clears it, a missing key leaves it. */
export type SizeChange = { size?: PlanSize | null; estimate?: number | null };

/**
 * How a chip reads: a forecast from runs, a size's default, the planner's proposal, a manual estimate, or
 * nothing; in a Flow project a size alone.
 */
export type ChipKind = "forecast" | "default" | "proposal" | "estimate" | "size" | "none";

export type Chip = {
  kind: ChipKind;
  /** The letter in the chip: the Size, else the proposal; undefined for an estimate without either. */
  size: PlanSize | undefined;
  /** The duration as the chip writes it: "~50m" for a forecast, "1.5d" for an estimate, "Size" with neither, "" for a Flow size. */
  text: string;
  /** The button's accessible name. */
  label: string;
  /** The hover text that says where the duration comes from; undefined with nothing to say. */
  title: string | undefined;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Hours in words, as a manual estimate's title writes them: "9 hours", "1 hour", "1.5 hours". */
export const hoursInWords = (hours: number) => `${Number(hours.toFixed(2))} ${hours === 1 ? "hour" : "hours"}`;

/** A sum of hours in words, as a story's or a column's title writes it: "2 hours 30 minutes", "50 minutes". */
export function durationInWords(hours: number): string {
  const minutes = Math.round(hours * 60);
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [whole && plural(whole, "hour"), rest && plural(rest, "minute")].filter(Boolean).join(" ") || "0 minutes";
}

/** What a size usually takes, as the plan writes durations: "50m", "2h". */
export const usually = (forecast: Forecast, capacity: number) => formatDuration(forecast.minutes / 60, capacity);

/** Where a size's forecast comes from, in a chip's hover text. */
export function forecastTitle(forecast: Forecast, capacity: number): string {
  const { size, runs } = forecast;
  if (forecast.source === "runs") return `Forecast for ${size}: usually ${usually(forecast, capacity)}, from ${plural(runs, "run")}`;
  const sofar = runs === 0 ? `No ${size} runs yet` : `${runs} ${size} ${runs === 1 ? "run" : "runs"} so far`;
  return `Default for ${size}: ${usually(forecast, capacity)}. ${sofar}; ${FORECAST_MIN_RUNS} needed`;
}

/** The forecast of a size in the size popover, with how much of it waits on the person or how far it is from its own runs. */
export function forecastSentence(forecast: Forecast, capacity: number, projectName: string): string {
  const { size, runs } = forecast;
  const time = usually(forecast, capacity);
  if (forecast.source === "runs") {
    const waiting = Math.round(forecast.parts?.waiting ?? 0);
    const part = waiting > 0 ? `, about ${formatDuration(waiting / 60, capacity)} of it waiting on you` : "";
    return `Forecast from ${runs} finished ${size} runs in ${projectName}: usually ${time}${part}.`;
  }
  const sofar = runs === 0 ? `No finished ${size} runs yet` : `${runs} finished ${size} ${runs === 1 ? "run" : "runs"} so far`;
  return `Default for ${size}: ${time}. ${sofar}; the forecast starts at ${FORECAST_MIN_RUNS}.`;
}

/** "the L default of 2h" or "the M forecast of 50m": what a manual estimate overrides. */
export const overridden = (forecast: Forecast, capacity: number) =>
  `the ${forecast.size} ${forecast.source === "runs" ? "forecast" : "default"} of ${usually(forecast, capacity)}`;

/** A sum of tasks' durations: "~2h 30m" when any part is a forecast, with how many tasks have neither size nor estimate. */
export type DurationSum = { text: string; more: number; title: string };

/**
 * The durations of a story's, an epic's or a column's tasks added up; undefined when none of them has one.
 * The text starts with "~" when any part is a forecast, and `more` counts the tasks with neither.
 */
export function sumOf(tasks: readonly SizedTask[], forecasts: Forecasts, capacity: number): DurationSum | undefined {
  const durations = tasks.map((t) => durationOf(t, forecasts, t.proposal?.size));
  const sized = durations.filter((d) => d !== undefined);
  if (sized.length === 0) return undefined;
  const hours = sized.reduce((sum, d) => sum + d.hours, 0);
  const estimates = sized.filter((d) => d.source === "estimate").length;
  const forecast = estimates < sized.length;
  const kinds = estimates === 0 ? "forecasts" : forecast ? "forecasts and estimates" : "estimates";
  const missing = tasks.filter((_, i) => !durations[i]).map((t) => `#${t.number}`);
  const without =
    missing.length === 0 ? "" : missing.length === 1 ? `; ${missing[0]} has no size` : missing.length === 2 ? `; ${missing.join(" and ")} have no size` : `; ${missing.length} tasks have no size`;
  return {
    text: `${forecast ? "~" : ""}${formatDuration(hours, capacity)}`,
    more: missing.length,
    title: `${durationInWords(hours)} over ${plural(sized.length, "task")}, ${kinds}${without}`,
  };
}

/**
 * A task's size chip: its manual estimate pinned, else its Size's forecast (dotted for a default), else the
 * planner's proposal (dashed), else "Size".
 */
export function chipOf(task: SizedTask, forecasts: Forecasts, capacity: number): Chip {
  const change = `Change the size or estimate of #${task.number}`;
  const duration = durationOf(task, forecasts, task.proposal?.size);
  if (!duration) return { kind: "none", size: undefined, text: "Size", label: `Set a size for #${task.number}`, title: undefined };
  const text = formatDuration(duration.hours, capacity);
  if (duration.source === "estimate") {
    const size = task.size;
    const overrides = size ? `; overrides ${overridden(forecasts[size], capacity)}` : "";
    return {
      kind: "estimate",
      size,
      text,
      label: `${size ? `Size ${size}, manual` : "Manual"} estimate ${text}. ${change}`,
      title: `Manual estimate ${hoursInWords(duration.hours)}${overrides}`,
    };
  }
  const size = (task.size ?? task.proposal?.size)!;
  const title = forecastTitle(forecasts[size], capacity);
  if (duration.source === "proposal") {
    return { kind: "proposal", size, text: `~${text}`, label: `Size ${size}, proposed by the planner, forecast ${text}. ${change}`, title: `Proposed by the planner. ${title}` };
  }
  const kind = duration.source === "forecast" ? "forecast" : "default";
  return { kind, size, text: `~${text}`, label: `Size ${size}, ${kind === "default" ? "default forecast" : "forecast"} ${text}. ${change}`, title };
}

/**
 * A task's size chip in a Flow project, which has no hours: its Size, else the planner's proposal (dashed),
 * else "Size". A manual estimate does not count.
 */
export function flowChipOf(task: SizedTask): Chip {
  const change = `Change the size of #${task.number}`;
  if (task.size) return { kind: "size", size: task.size, text: "", label: `Size ${task.size}. ${change}`, title: `Size ${task.size}` };
  const proposed = task.proposal?.size;
  if (proposed) return { kind: "proposal", size: proposed, text: "", label: `Size ${proposed}, proposed by the planner. ${change}`, title: "Proposed by the planner" };
  return { kind: "none", size: undefined, text: "Size", label: `Set a size for #${task.number}`, title: undefined };
}

/**
 * The sizes of a story's, an epic's or a column's tasks counted, as a Flow project shows them in place of a
 * sum of hours: "2 S, 1 M, 1 unsized", sizes with none left out. A task counts by its Size field; a planner's
 * proposal or a manual estimate alone leaves it unsized. Undefined when no task has a size.
 */
export function sizeCountOf(tasks: readonly SizedTask[]): { text: string; title: string } | undefined {
  const counts = SIZES.map((size) => [size, tasks.filter((t) => t.size === size).length] as const).filter(([, n]) => n > 0);
  if (counts.length === 0) return undefined;
  const unsized = tasks.filter((t) => !t.size).length;
  const text = [...counts.map(([size, n]) => `${n} ${size}`), ...(unsized > 0 ? [`${unsized} unsized`] : [])].join(", ");
  return { text, title: `${plural(tasks.length, "task")}: ${text}` };
}

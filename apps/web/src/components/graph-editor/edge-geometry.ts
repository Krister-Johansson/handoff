import type { EdgeAttributes } from "@handoff/core";
import { describeCondition } from "@/lib/condition-text";
import { MAX_LABEL_CHARS } from "@/lib/elk-layout";

/** Whether an edge loops back: marked as a loop, or sending feedback (a loop of three by default). */
export const loops = (data: EdgeAttributes | undefined) => Boolean(data?.loop || data?.input === "feedback");

/** The text on an edge: its port (or custom condition), when it fires and its loop budget. */
export function edgeLabel(data: EdgeAttributes | undefined): string {
  const port = data?.port?.replace("_", " ");
  const condition = port ? (data?.condition ? `${port} (custom)` : port) : describeCondition(data?.condition);
  const loop = loops(data) ? `loop ×${data?.maxAttempts ?? (data?.input === "feedback" ? 3 : "?")}` : "";
  const on = !port && data?.on && data.on !== "passed" ? `on ${data.on}` : "";
  const label = [on, condition, loop].filter(Boolean).join(" · ");
  return label.length > MAX_LABEL_CHARS ? `${label.slice(0, MAX_LABEL_CHARS - 1)}…` : label;
}

/** Loop edges arc below the nodes so they never run along the forward path. */
export function loopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const dy = 90 + Math.abs(sx - tx) * 0.12;
  const path = `M ${sx},${sy} C ${sx + 80},${sy + dy} ${tx - 80},${ty + dy} ${tx},${ty}`;
  return [path, (sx + tx) / 2, (sy + ty) / 2 + 0.75 * dy];
}

/** Loop edges are dashed; failure edges are red; the label shows the condition and loop budget. */
export function edgeStyle(data: EdgeAttributes | undefined, selected: boolean | undefined, invalid = false) {
  return {
    strokeDasharray: loops(data) ? "6 4" : undefined,
    stroke: invalid || data?.on === "failed" ? "var(--destructive)" : selected ? "var(--primary)" : "var(--muted-foreground)",
    strokeWidth: invalid || selected ? 2 : 1.5,
  };
}

type Point = { x: number; y: number };
const fmt = (n: number) => Math.round(n * 10) / 10;

/** An orthogonal polyline as an SVG path, with each corner rounded by up to `radius`. */
export function roundedPath(points: Point[], radius = 10): string {
  const [first, ...rest] = points;
  if (!first) return "";
  const parts = [`M ${fmt(first.x)},${fmt(first.y)}`];
  for (let i = 0; i < rest.length; i++) {
    const corner = rest[i]!;
    const next = rest[i + 1];
    if (!next) {
      parts.push(`L ${fmt(corner.x)},${fmt(corner.y)}`);
      break;
    }
    const prev = points[i]!;
    const inLength = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const before = { x: corner.x - ((corner.x - prev.x) / (inLength || 1)) * r, y: corner.y - ((corner.y - prev.y) / (inLength || 1)) * r };
    const after = { x: corner.x + ((next.x - corner.x) / (outLength || 1)) * r, y: corner.y + ((next.y - corner.y) / (outLength || 1)) * r };
    parts.push(`L ${fmt(before.x)},${fmt(before.y)}`, `Q ${fmt(corner.x)},${fmt(corner.y)} ${fmt(after.x)},${fmt(after.y)}`);
  }
  return parts.join(" ");
}

/**
 * The layout's route for an edge, snapped onto the handles React Flow reports, or undefined when an
 * end has moved more than `tolerance` pixels since the layout (the caller then draws its own curve).
 */
export function routeFor(
  route: { points: Point[] } | undefined,
  ends: { sourceX: number; sourceY: number; targetX: number; targetY: number },
  tolerance = 6,
): Point[] | undefined {
  const points = route?.points;
  if (!points || points.length < 2) return undefined;
  const start = points[0]!;
  const end = points.at(-1)!;
  const near = (a: Point, x: number, y: number) => Math.abs(a.x - x) <= tolerance && Math.abs(a.y - y) <= tolerance;
  if (!near(start, ends.sourceX, ends.sourceY) || !near(end, ends.targetX, ends.targetY)) return undefined;
  const snapped = points.map((p) => ({ ...p }));
  // Keep the first and last segments straight: points on the old start or end line move with it.
  if (snapped.length > 2 && Math.abs(snapped[1]!.y - start.y) < 0.5) snapped[1]!.y = ends.sourceY;
  if (snapped.length > 2 && Math.abs(snapped.at(-2)!.y - end.y) < 0.5) snapped.at(-2)!.y = ends.targetY;
  snapped[0] = { x: ends.sourceX, y: ends.sourceY };
  snapped[snapped.length - 1] = { x: ends.targetX, y: ends.targetY };
  return snapped;
}

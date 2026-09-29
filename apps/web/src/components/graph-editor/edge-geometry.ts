import type { EdgeAttributes } from "@handoff/core";

/** Loop edges arc below the nodes so they never run along the forward path. */
export function loopPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const dy = 90 + Math.abs(sx - tx) * 0.12;
  const path = `M ${sx},${sy} C ${sx + 80},${sy + dy} ${tx - 80},${ty + dy} ${tx},${ty}`;
  return [path, (sx + tx) / 2, (sy + ty) / 2 + 0.75 * dy];
}

/** Loop edges are dashed; failure edges are red; the label shows the condition and loop budget. */
export function edgeStyle(data: EdgeAttributes | undefined, selected: boolean | undefined) {
  return {
    strokeDasharray: data?.loop ? "6 4" : undefined,
    stroke: data?.on === "failed" ? "var(--destructive)" : selected ? "var(--primary)" : "var(--muted-foreground)",
    strokeWidth: selected ? 2 : 1.5,
  };
}

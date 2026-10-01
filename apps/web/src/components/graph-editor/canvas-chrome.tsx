"use client";

import { Background, BackgroundVariant, MiniMap } from "@xyflow/react";
import { PANEL_CLASS } from "./canvas-style";

/** A faint dot grid, 20 pixels apart. */
export function CanvasBackground() {
  return <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="color-mix(in oklab, var(--foreground) 12%, transparent)" />;
}

export function CanvasMiniMap() {
  return <MiniMap pannable zoomable nodeBorderRadius={2} className={`${PANEL_CLASS} overflow-hidden opacity-90`} style={{ width: 150, height: 90 }} />;
}

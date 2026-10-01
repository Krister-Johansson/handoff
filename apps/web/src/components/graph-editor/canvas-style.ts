import type { CSSProperties } from "react";

/**
 * React Flow's controls and minimap in the dashboard's colours. Set as variables on the flow, so
 * they follow the light and dark theme with the rest of the page.
 */
export const CANVAS_STYLE = {
  "--xy-controls-button-background-color": "var(--card)",
  "--xy-controls-button-background-color-hover": "var(--muted)",
  "--xy-controls-button-color": "var(--muted-foreground)",
  "--xy-controls-button-color-hover": "var(--foreground)",
  "--xy-controls-button-border-color": "transparent",
  "--xy-controls-box-shadow": "none",
  "--xy-minimap-background-color": "var(--subtle)",
  "--xy-minimap-mask-background-color": "color-mix(in oklab, var(--background) 60%, transparent)",
  "--xy-minimap-node-background-color": "var(--secondary)",
} as CSSProperties;

/** A floating panel on the canvas: the palette, the toolbar, the controls and the legend. */
export const PANEL_CLASS = "rounded-lg border border-input bg-card shadow-xs";

/** The zoom controls as a panel of small square buttons. */
export const CONTROLS_CLASS = `${PANEL_CLASS} overflow-hidden p-0.5 [&_.react-flow__controls-button]:size-7 [&_.react-flow__controls-button]:rounded-[5px]`;

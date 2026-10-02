import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom has neither; Radix (checkbox, popover) and cmdk use them.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
// Nor element scrolling; the plan timeline scrolls its time pane to today.
Element.prototype.scrollTo ??= () => {};
// jsdom has no matchMedia; the sidebar's useIsMobile asks it for the phone breakpoint. Nothing matches.
window.matchMedia ??= (query: string) =>
  ({ matches: false, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList;

afterEach(() => cleanup());

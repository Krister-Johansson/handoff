import { vi } from "vitest";

/**
 * Makes every image with a source load at once, as a browser would. jsdom loads no images, so without
 * this an avatar never leaves its fallback. Undo it with vi.unstubAllGlobals().
 */
export function loadImages() {
  vi.stubGlobal(
    "Image",
    class extends EventTarget {
      complete = true;
      naturalWidth = 48;
      src = "";
      referrerPolicy = "";
      crossOrigin: string | null = null;
    },
  );
}

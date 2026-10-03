import { expect, test } from "vitest";
import { buildRunCardHtml } from "./bundle";
import { RUN_CARD_HTML } from "./run-card.generated";

test("the committed run card is the bundle of its source; pnpm build:mcp-apps writes it again", async () => {
  expect(RUN_CARD_HTML).toBe(await buildRunCardHtml());
});

test("the run card is one HTML document that loads nothing from another origin", () => {
  expect(RUN_CARD_HTML).toMatch(/^<!doctype html>/i);
  expect(RUN_CARD_HTML).toContain('<div id="root"></div>');
  // Script and style are inline: no element names a source, a stylesheet or an import from elsewhere.
  expect(RUN_CARD_HTML).not.toMatch(/<script[^>]*\ssrc=/i);
  expect(RUN_CARD_HTML).not.toMatch(/<link[^>]*rel=["']?stylesheet/i);
  expect(RUN_CARD_HTML).not.toMatch(/@import\s/);
  expect(RUN_CARD_HTML).not.toMatch(/\bimport\s*\(\s*["']https?:/);
});

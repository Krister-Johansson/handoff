import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { buildSandboxProxyScript, buildViews, GENERATED_FILE, generatedSource, VIEWS, viewHtml } from "./bundle";
import { SANDBOX_PROXY_SCRIPT } from "./sandbox-proxy.generated";
import * as generated from "./views.generated";

const committed = (constant: string) => (generated as Record<string, string>)[constant]!;

test("the committed views are the bundle of their source; pnpm build:mcp-apps writes them again", async () => {
  const built = await buildViews();
  expect(await readFile(GENERATED_FILE, "utf8")).toBe(generatedSource(built));
  for (const view of VIEWS) expect(committed(view.constant), view.name).toBe(viewHtml(view, built));
});

test("the committed sandbox proxy is the bundle of its source and imports nothing", async () => {
  expect(SANDBOX_PROXY_SCRIPT).toBe(await buildSandboxProxyScript());
  expect(SANDBOX_PROXY_SCRIPT).not.toMatch(/\bimport\s*\(|<\/script/i);
});

test("each view is one HTML document that loads nothing from another origin and starts its own view", () => {
  for (const view of VIEWS) {
    const html = committed(view.constant);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain(`<div id="root" data-view="${view.name}"></div>`);
    // Script and style are inline: no element names a source, a stylesheet or an import from elsewhere.
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link[^>]*rel=["']?stylesheet/i);
    expect(html).not.toMatch(/@import\s/);
    expect(html).not.toMatch(/\bimport\s*\(\s*["']https?:/);
  }
});

test("the views stay small: each page under 320 KB, with one runtime they share, committed once", async () => {
  const sizes = VIEWS.map((view) => ({ view: view.name, kb: Buffer.byteLength(committed(view.constant)) / 1024 }));
  for (const { view, kb } of sizes) expect(kb, view).toBeLessThan(320);
  // The generated file holds the script and the style once, not once per view.
  const file = Buffer.byteLength(await readFile(GENERATED_FILE, "utf8")) / 1024;
  expect(file).toBeLessThan(Math.max(...sizes.map((s) => s.kb)) * 1.25);
});

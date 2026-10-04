import { afterEach, expect, it, vi } from "vitest";

// Next.js renders the app with its own React build (next/dist/compiled), not the react package the other
// web tests use, and only that build logs the script tag error. This file renders with Next's build;
// vitest.config.ts inlines next-themes so that its React import gets the same build.
vi.mock("react", () => import("next/dist/compiled/react"));
vi.mock("react/jsx-dev-runtime", () => import("next/dist/compiled/react/jsx-dev-runtime"));
vi.mock("react-dom/client", () => import("next/dist/compiled/react-dom/client"));

import { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./theme-provider";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.restoreAllMocks();
});

it("renders on the client without React's script tag error", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);

  act(() =>
    root.render(
      <ThemeProvider>
        <p>page</p>
      </ThemeProvider>,
    ),
  );

  expect(container).toHaveTextContent("page");
  expect(consoleError.mock.calls.map((args) => String(args[0]))).not.toContainEqual(
    expect.stringContaining("Encountered a script tag"),
  );
  act(() => root.unmount());
  container.remove();
});

it("keeps an executable theme script in the server HTML, so the theme applies before the first paint", async () => {
  vi.stubGlobal("window", undefined);
  vi.resetModules();
  const { renderToString } = await import("next/dist/compiled/react-dom/server");
  const { ThemeProvider: ServerThemeProvider } = await import("./theme-provider");
  vi.unstubAllGlobals();

  const html = renderToString(
    <ServerThemeProvider>
      <p>page</p>
    </ServerThemeProvider>,
  );

  const template = document.createElement("template");
  template.innerHTML = html;
  const script = template.content.querySelector("script");
  expect(script?.textContent).toContain("prefers-color-scheme");
  // No type attribute: the browser runs it as JavaScript.
  expect(script?.getAttribute("type")).toBeNull();
});

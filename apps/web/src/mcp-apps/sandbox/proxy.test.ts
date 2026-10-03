import { afterEach, expect, test, vi } from "vitest";
import { startSandboxProxy, viewCsp } from "./proxy";

const HOST = "http://127.0.0.1:3000";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** The proxy in a frame of the test window, which plays the dashboard: messages to it are recorded. */
function proxy() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const win = frame.contentWindow!;
  // The frame's parent: jsdom's own proxy of the test window.
  const host = win.parent;
  const toHost: { data: unknown; origin: string }[] = [];
  vi.spyOn(host, "postMessage").mockImplementation(((data: unknown, origin: string) => void toHost.push({ data, origin })) as typeof window.postMessage);
  startSandboxProxy(win, HOST);
  const send = (data: unknown, from: { origin: string; source: Window | null }) => win.dispatchEvent(new MessageEvent("message", { data, ...from }));
  const fromHost = (data: unknown) => send(data, { origin: HOST, source: host });
  const inner = () => win.document.querySelector("iframe");
  return { win, host, toHost, send, fromHost, inner };
}

const loadView = (p: ReturnType<typeof proxy>, params: Record<string, unknown> = {}) =>
  p.fromHost({ jsonrpc: "2.0", method: "ui/notifications/sandbox-resource-ready", params: { html: "<!doctype html><html><head><title>v</title></head><body>hi</body></html>", ...params } });

test("the proxy tells the dashboard, and only the dashboard's origin, that it is ready", () => {
  const p = proxy();
  expect(p.toHost).toEqual([{ data: { jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, origin: HOST }]);
  expect(p.inner()).toBeNull();
});

test("the view's HTML loads in an inner frame that may only run scripts, under the CSP its resource declares", () => {
  const p = proxy();
  loadView(p, { csp: { connectDomains: ["https://api.example.com"], resourceDomains: [] } });
  const inner = p.inner()!;
  expect(inner.getAttribute("sandbox")).toBe("allow-scripts");
  const srcdoc = inner.getAttribute("srcdoc")!;
  // The CSP goes first in the head, so it covers every script and style of the view.
  expect(srcdoc).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="[^"]+"><title>v<\/title>/);
  const csp = /content="([^"]+)"/.exec(srcdoc)![1]!;
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("connect-src 'self' https://api.example.com");
  expect(csp).toContain("frame-src 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
});

test("a view's CSP keeps only the domains it declares, and drops anything that would add a directive", () => {
  const csp = viewCsp({ resourceDomains: ["https://cdn.example.com", "https://x.example.com; script-src *", "'unsafe-eval'"], frameDomains: ["https://www.youtube.com"] });
  expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.example.com;");
  expect(csp).toContain("frame-src https://www.youtube.com;");
  expect(csp).not.toContain("x.example.com");
  expect(csp).not.toContain("unsafe-eval");
  // Nothing declared: the restrictive defaults.
  expect(viewCsp(undefined)).toBe(
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; media-src 'self' data:; frame-src 'none'; object-src 'none'; base-uri 'self'",
  );
});

test("the proxy passes messages both ways between the dashboard and the view, but no sandbox notification and nothing from elsewhere", () => {
  const p = proxy();
  loadView(p);
  const view = p.inner()!.contentWindow!;
  const toView: unknown[] = [];
  vi.spyOn(view, "postMessage").mockImplementation(((data: unknown) => void toView.push(data)) as typeof view.postMessage);
  p.toHost.length = 0;

  const initialize = { jsonrpc: "2.0", id: 1, method: "ui/initialize", params: {} };
  p.send(initialize, { origin: "null", source: view });
  expect(p.toHost).toEqual([{ data: initialize, origin: HOST }]);
  const answer = { jsonrpc: "2.0", id: 1, result: { hostContext: {} } };
  p.fromHost(answer);
  expect(toView).toEqual([answer]);

  // A view may not speak for the proxy, a second resource is not passed on, and other windows and origins are ignored.
  p.send({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, { origin: "null", source: view });
  loadView(p, { html: "<p>again</p>" });
  p.send({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, { origin: "https://evil.example", source: p.host });
  p.send({ jsonrpc: "2.0", method: "ui/notifications/initialized" }, { origin: HOST, source: null });
  expect(p.toHost).toHaveLength(1);
  expect(toView).toHaveLength(1);
  expect(p.win.document.querySelectorAll("iframe")).toHaveLength(1);
});

test("the proxy and its view take the dashboard's color scheme, so neither paints a backdrop of the other theme", () => {
  const p = proxy();
  loadView(p);
  const view = p.inner()!;
  vi.spyOn(view.contentWindow!, "postMessage").mockImplementation(() => {});
  p.fromHost({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2026-01-26", hostContext: { theme: "dark" } } });
  expect(p.win.document.documentElement.style.colorScheme).toBe("dark");
  expect(view.style.colorScheme).toBe("dark");
  p.fromHost({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "light" } });
  expect(p.win.document.documentElement.style.colorScheme).toBe("light");
  expect(view.style.colorScheme).toBe("light");
});

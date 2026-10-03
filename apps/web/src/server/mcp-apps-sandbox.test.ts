import { afterAll, expect, test } from "vitest";
import { SANDBOX_PROXY_SCRIPT } from "../mcp-apps/sandbox-proxy.generated";
import { closeSandboxProxy, sandboxProxyOrigin } from "./mcp-apps-sandbox";

afterAll(closeSandboxProxy);

const DASHBOARD = "http://127.0.0.1:3000";
const page = async (host: string, path = "/sandbox") => fetch(`${await sandboxProxyOrigin()}${path}?host=${encodeURIComponent(host)}`);

test("the sandbox proxy has an origin of its own on this machine, the same for every view", async () => {
  const origin = await sandboxProxyOrigin();
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(origin).not.toBe(DASHBOARD);
  expect(await sandboxProxyOrigin()).toBe(origin);
});

test("the proxy page names the dashboard that frames it, and only that dashboard may frame it", async () => {
  const response = await page(DASHBOARD);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("content-security-policy")).toBe(`frame-ancestors 'self' ${DASHBOARD}; object-src 'none'; base-uri 'none'; form-action 'none'`);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const html = await response.text();
  expect(html).toContain(`<meta name="handoff-host-origin" content="${DASHBOARD}">`);
  expect(html).toContain(SANDBOX_PROXY_SCRIPT.slice(0, 200));
});

test("the proxy serves no other page and no host that is not this machine's dashboard", async () => {
  expect((await page("https://evil.example")).status).toBe(400);
  expect((await page(`${DASHBOARD}/path`)).status).toBe(400);
  expect((await page("javascript:alert(1)")).status).toBe(400);
  expect((await page(DASHBOARD, "/api/assistant/conversations")).status).toBe(404);
  expect((await fetch(`${await sandboxProxyOrigin()}/sandbox?host=${encodeURIComponent(DASHBOARD)}`, { method: "POST" })).status).toBe(405);
});

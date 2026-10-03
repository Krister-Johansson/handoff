import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sandboxProxyPage } from "../mcp-apps/sandbox/proxy-page";
import { isLocalHost } from "./local-request";

/**
 * The sandbox proxy that frames MCP Apps views in the assistant panel. The specification (2026-01-26, "Sandbox
 * proxy") has a web host frame views through a proxy on an origin other than its own. The dashboard has no login:
 * any page of its own origin may call its routes. So the proxy gets a server of its own on another port of this
 * machine, which serves the proxy page and nothing else. A view inside it reaches no dashboard route as its own
 * origin, and its own frame keeps an opaque origin besides.
 */

type Sandbox = { server: Server; origin: Promise<string> };
const KEY = Symbol.for("handoff.mcpAppsSandbox");
const store = globalThis as typeof globalThis & { [KEY]?: Sandbox };

/** The dashboard origin a proxy page may be framed by: http or https on this machine, with nothing after the port. */
function dashboardOrigin(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value && isLocalHost(url.host) ? value : undefined;
  } catch {
    return undefined;
  }
}

function serve(): Sandbox {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://sandbox");
    if (url.pathname !== "/sandbox") return void response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found.");
    if (request.method !== "GET" && request.method !== "HEAD") return void response.writeHead(405, { allow: "GET, HEAD" }).end();
    const host = dashboardOrigin(url.searchParams.get("host"));
    if (!host) return void response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("The host must be the dashboard's origin on this machine.");
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // Only the dashboard frames the proxy. The view's own CSP, from its resource, goes in its document.
      "content-security-policy": `frame-ancestors 'self' ${host}; object-src 'none'; base-uri 'none'; form-action 'none'`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(request.method === "HEAD" ? undefined : sandboxProxyPage(host));
  });
  const origin = new Promise<string>((resolve, reject) => {
    server.once("error", reject);
    // HANDOFF_SANDBOX_PORT pins the port; by default the system picks a free one.
    server.listen(Number(process.env.HANDOFF_SANDBOX_PORT) || 0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
  // The dashboard can stop without waiting for it.
  server.unref();
  return { server, origin };
}

/** The proxy's origin, starting its server the first time. A failed start is tried again on the next call. */
export async function sandboxProxyOrigin(): Promise<string> {
  const sandbox = (store[KEY] ??= serve());
  try {
    return await sandbox.origin;
  } catch (error) {
    if (store[KEY] === sandbox) delete store[KEY];
    throw error;
  }
}

/** Stops the proxy's server, as the tests do. */
export async function closeSandboxProxy() {
  const sandbox = store[KEY];
  delete store[KEY];
  if (sandbox) await new Promise<void>((resolve) => sandbox.server.close(() => resolve()));
}

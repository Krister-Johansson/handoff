/**
 * The sandbox proxy of MCP Apps (specification 2026-01-26, "Sandbox proxy"): the page a web host frames from
 * an origin of its own. It loads a view's HTML into an inner frame that may only run scripts, under the CSP the
 * view's resource declares, and passes messages between the host and the view. pnpm build:mcp-apps bundles it into
 * sandbox-proxy.generated.ts, and the dashboard serves it on a port of its own (src/server/mcp-apps-sandbox.ts).
 */

/** The domains a view's resource declares in _meta.ui.csp. */
export type ViewCsp = { connectDomains?: string[] | undefined; resourceDomains?: string[] | undefined; frameDomains?: string[] | undefined; baseUriDomains?: string[] | undefined };
/** The browser features a view's resource asks for in _meta.ui.permissions. */
export type ViewPermissions = { camera?: object | undefined; microphone?: object | undefined; geolocation?: object | undefined; clipboardWrite?: object | undefined };

const READY = "ui/notifications/sandbox-proxy-ready";
const RESOURCE_READY = "ui/notifications/sandbox-resource-ready";
/** Messages between the host and the proxy only; the proxy passes none of them on. */
const RESERVED = "ui/notifications/sandbox-";

/** A source a CSP list can hold: an origin or a host pattern, never a keyword, a quote or a separator. */
const isSource = (domain: unknown): domain is string => typeof domain === "string" && /^[a-z][a-z0-9+.-]*:\/\/[^\s;,'"]+$|^[*a-z0-9][^\s;,'":]*(:\d+)?$/i.test(domain);
const sources = (domains: string[] | undefined) => (domains ?? []).filter(isSource);
const directive = (name: string, ...values: string[]) => [name, ...values].join(" ");

/**
 * The view's content security policy as the specification builds it from _meta.ui.csp: the declared domains
 * and nothing else, frames and other base URIs only when declared, no plugins.
 */
export function viewCsp(csp: ViewCsp | undefined): string {
  const resource = sources(csp?.resourceDomains);
  const frames = sources(csp?.frameDomains);
  const bases = sources(csp?.baseUriDomains);
  return [
    directive("default-src", "'none'"),
    directive("script-src", "'self'", "'unsafe-inline'", ...resource),
    directive("style-src", "'self'", "'unsafe-inline'", ...resource),
    directive("connect-src", "'self'", ...sources(csp?.connectDomains)),
    directive("img-src", "'self'", "data:", ...resource),
    directive("font-src", "'self'", ...resource),
    directive("media-src", "'self'", "data:", ...resource),
    directive("frame-src", ...(frames.length ? frames : ["'none'"])),
    directive("object-src", "'none'"),
    directive("base-uri", ...(bases.length ? bases : ["'self'"])),
  ].join("; ");
}

const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** The view's HTML with its CSP as the first element of its head, before any script or style. */
export function withCsp(html: string, csp: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${attribute(csp)}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? doctype[0] + meta + html.slice(doctype[0].length) : meta + html;
}

/** The inner frame's allow attribute: the features the view asks for that a frame can be granted. */
function allowOf(permissions: ViewPermissions | undefined) {
  const features: [keyof ViewPermissions, string][] = [
    ["camera", "camera"],
    ["microphone", "microphone"],
    ["geolocation", "geolocation"],
    ["clipboardWrite", "clipboard-write"],
  ];
  return features.flatMap(([key, feature]) => (permissions?.[key] ? [feature] : [])).join("; ");
}

type Message = { method?: unknown; params?: Record<string, unknown>; result?: { hostContext?: { theme?: unknown } } };

/** The theme a message from the host sets: in the answer to ui/initialize, or in a host context change. */
function themeOf(message: Message) {
  const theme = message.method === "ui/notifications/host-context-changed" ? message.params?.theme : message.result?.hostContext?.theme;
  return theme === "light" || theme === "dark" ? theme : undefined;
}

/**
 * Runs the proxy in `win`, framed by the host at `hostOrigin`. It says it is ready, loads the first view the host
 * sends, then passes every message between the two, except the sandbox notifications. Only the host's frame at
 * its origin and the view's own frame are heard.
 */
export function startSandboxProxy(win: Window, hostOrigin: string) {
  const doc = win.document;
  let view: HTMLIFrameElement | undefined;
  const toHost = (message: unknown) => win.parent.postMessage(message, hostOrigin);

  // A frame paints an opaque backdrop when its color scheme differs from its document's, so the proxy and its
  // frame take the host's theme, as the view does.
  const followTheme = (theme: "light" | "dark") => {
    doc.documentElement.style.colorScheme = theme;
    if (view) view.style.colorScheme = theme;
  };

  const load = (params: Record<string, unknown> | undefined) => {
    if (view || typeof params?.html !== "string") return;
    view = doc.createElement("iframe");
    view.title = "View";
    // The view's origin stays opaque: it reaches neither the proxy nor the host, only their messages.
    view.setAttribute("sandbox", typeof params.sandbox === "string" ? params.sandbox : "allow-scripts");
    const allow = allowOf(params.permissions as ViewPermissions | undefined);
    if (allow) view.setAttribute("allow", allow);
    view.setAttribute("srcdoc", withCsp(params.html, viewCsp(params.csp as ViewCsp | undefined)));
    doc.body.append(view);
  };

  win.addEventListener("message", (event) => {
    const message = event.data as Message | null;
    if (!message || typeof message !== "object") return;
    const method = typeof message.method === "string" ? message.method : "";
    if (event.source === win.parent && event.origin === hostOrigin) {
      if (method === RESOURCE_READY) return load(message.params);
      if (method.startsWith(RESERVED)) return;
      const theme = themeOf(message);
      if (theme) followTheme(theme);
      view?.contentWindow?.postMessage(message, "*");
      return;
    }
    if (view && event.source === view.contentWindow && !method.startsWith(RESERVED)) toHost(message);
  });

  toHost({ jsonrpc: "2.0", method: READY, params: {} });
}

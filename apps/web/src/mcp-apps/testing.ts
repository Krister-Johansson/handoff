// A host for the views' tests: an AppBridge on one end, the view on the other, as a host that renders MCP Apps mounts it.
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { App, McpUiHostCapabilities } from "@modelcontextprotocol/ext-apps";
import { InMemoryTransport, type CallToolResult, type Transport } from "@modelcontextprotocol/client";

export type ToolCall = { name: string; arguments: Record<string, unknown> };
type Handler = (args: Record<string, unknown>) => CallToolResult | Promise<CallToolResult>;

/** A tool's result as handoff's server returns it: one block of pretty JSON text. */
export const textResult = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
export const errorResult = (text: string): CallToolResult => ({ content: [{ type: "text", text }], isError: true });

/** A result the test hands back when it decides, to see what the view shows while it waits. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let mounted: AppBridge[] = [];

/** Closes the hosts of the views a test mounted, after the view's next frame (it reports its size then). */
export async function unmountViews() {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await Promise.all(mounted.map((bridge) => bridge.close()));
  mounted = [];
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-theme");
}

/**
 * Mounts a view and sends it the tool's input and result. The host opens links and proxies tool calls to `tools`
 * unless `capabilities` says otherwise; `calls` records every call the view makes, in order.
 */
export async function mountView(
  start: (root: HTMLElement, transport?: Transport) => Promise<App>,
  options: { input?: Record<string, unknown>; result?: CallToolResult; tools?: Record<string, Handler>; capabilities?: McpUiHostCapabilities; theme?: "light" | "dark" },
) {
  const root = document.createElement("div");
  document.body.append(root);
  const bridge = new AppBridge(null, { name: "test-host", version: "1.0.0" }, options.capabilities ?? { openLinks: {}, serverTools: {} }, { hostContext: { theme: options.theme ?? "light" } });
  mounted.push(bridge);
  const opened: string[] = [];
  const calls: ToolCall[] = [];
  bridge.onopenlink = async ({ url }) => {
    opened.push(url);
    return {};
  };
  bridge.oncalltool = async ({ name, arguments: args = {} }) => {
    calls.push({ name, arguments: args });
    const handler = options.tools?.[name];
    if (!handler) throw new Error(`The test host has no tool ${name}.`);
    return handler(args);
  };
  const initialized = new Promise<void>((resolve) => (bridge.oninitialized = () => resolve()));
  const [viewSide, hostSide] = InMemoryTransport.createLinkedPair();
  await bridge.connect(hostSide);
  await start(root, viewSide);
  await initialized;
  if (options.input) await bridge.sendToolInput({ arguments: options.input });
  if (options.result) await bridge.sendToolResult(options.result);
  return { root, bridge, opened, calls };
}

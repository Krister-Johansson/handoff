"use client";

import type { McpUiHostContext, McpUiStyles } from "@modelcontextprotocol/ext-apps";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useIsDark } from "@/hooks/use-is-dark";
import type { ToolCallView } from "@/lib/assistant/port";
import type { AppViewResource } from "@/lib/assistant/transport";
import type { ViewToolCall, ViewToolResult } from "@/lib/assistant/view-tools";
import { cn } from "@/lib/utils";

type BridgeModule = typeof import("@modelcontextprotocol/ext-apps/app-bridge");

const HOST = { name: "handoff dashboard", version: "1.0.0" };
/** How long a view has to start before the card gives way to the tool row. */
const START_TIMEOUT_MS = 15_000;

/** The dashboard's tokens as the specification's style variables, read from <html> in the current theme. */
const STYLE_TOKENS: [keyof McpUiStyles, string, string?][] = [
  ["--color-background-primary", "--background"],
  ["--color-background-secondary", "--muted"],
  ["--color-text-primary", "--foreground"],
  ["--color-text-secondary", "--muted-foreground"],
  ["--color-border-primary", "--border"],
  ["--color-ring-primary", "--ring"],
  ["--border-radius-md", "--radius"],
  // next/font names faces only the dashboard's document has, so the view gets a generic family after them.
  ["--font-sans", "--font-sans", "ui-sans-serif, system-ui, sans-serif"],
  ["--font-mono", "--font-geist-mono", "ui-monospace, SFMono-Regular, Menlo, monospace"],
];

function styleVariables(): Partial<McpUiStyles> {
  const style = getComputedStyle(document.documentElement);
  const variables: Partial<McpUiStyles> = {};
  for (const [key, token, generic] of STYLE_TOKENS) {
    const value = style.getPropertyValue(token).trim();
    if (value) variables[key] = generic ? `${value}, ${generic}` : value;
  }
  return variables;
}

/** What the view knows of the dashboard: its theme and style, inline in a chat reply, on the web. */
function hostContext(dark: boolean): McpUiHostContext {
  return {
    theme: dark ? "dark" : "light",
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    platform: "web",
    locale: navigator.language,
    styles: { variables: styleVariables() as McpUiStyles },
  };
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The dashboard path of a link, when it points at this dashboard (on any of this machine's names); else undefined. */
function dashboardPath(url: URL): string | undefined {
  const here = window.location;
  const local = LOOPBACK.has(url.hostname) && LOOPBACK.has(here.hostname) && url.port === here.port && url.protocol === here.protocol;
  return url.origin === here.origin || local ? `${url.pathname}${url.search}${url.hash}` : undefined;
}

/**
 * A tool call drawn by its MCP Apps view, as a host of the specification (2026-01-26) draws it: the view runs in
 * the sandbox proxy's frame, on an origin other than the dashboard's, and an AppBridge talks to it over postMessage.
 * The bridge sends the call's input and, once it has one, its result; follows the dashboard's theme; sizes the
 * frame to the view; opens the links the view asks for, dashboard pages in this tab; and passes the tools the view
 * calls to `callTool`. `onFail` says the view could not be read or did not start, and `onReady` that it did.
 */
export function McpAppView({
  call,
  load,
  onFail,
  onReady,
  callTool,
  timeoutMs = START_TIMEOUT_MS,
}: {
  call: ToolCallView;
  load: (uri: string) => Promise<AppViewResource>;
  onFail: () => void;
  onReady?: () => void;
  /** Runs a tool the view calls (tools/call); without it the host offers the view no server tools. */
  callTool?: (call: ViewToolCall, signal: AbortSignal) => Promise<ViewToolResult>;
  timeoutMs?: number;
}) {
  const router = useRouter();
  const dark = useIsDark();
  const frame = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<AppBridge | undefined>(undefined);
  const sent = useRef({ input: false, result: false });
  const [loaded, setLoaded] = useState<{ resource: AppViewResource; module: BridgeModule }>();
  const [src, setSrc] = useState<string>();
  const [height, setHeight] = useState<number>();
  const [initialized, setInitialized] = useState(false);
  const fail = useEffectEvent(() => onFail());
  const ready = useEffectEvent(() => onReady?.());
  const currentContext = useEffectEvent(() => hostContext(dark));
  const canCallTools = callTool !== undefined;
  const runTool = useEffectEvent((request: ViewToolCall, signal: AbortSignal) => callTool!(request, signal));
  const openLink = useEffectEvent((href: string) => {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const path = dashboardPath(url);
    if (path) router.push(path);
    else window.open(url.href, "_blank", "noopener,noreferrer");
    return true;
  });

  // The view's resource and the bridge's code, which only pages with a card load.
  const uri = call.view;
  useEffect(() => {
    if (!uri) return;
    let live = true;
    const read = async () => {
      try {
        const [resource, module] = await Promise.all([load(uri), import("@modelcontextprotocol/ext-apps/app-bridge")]);
        if (live) setLoaded({ resource, module });
      } catch {
        if (live) fail();
      }
    };
    void read();
    return () => {
      live = false;
    };
  }, [uri, load]);

  // The bridge listens before the frame loads the proxy, so it hears the proxy say it is ready. Its cleanup runs
  // while the frame is still in the page, so the teardown request goes out before the frame does.
  useLayoutEffect(() => {
    const target = frame.current?.contentWindow;
    if (!loaded || !target) return;
    const { resource, module } = loaded;
    const host = new module.AppBridge(null, HOST, { openLinks: {}, ...(canCallTools ? { serverTools: {} } : {}) }, { hostContext: currentContext() });
    // Ends the view's open tool calls when the card goes: an open approval card counts as denied.
    const calls = new AbortController();
    let closed = false;
    const timer = setTimeout(() => fail(), timeoutMs);
    const onSandboxReady = () => {
      void host.sendSandboxResourceReady({
        html: resource.html,
        sandbox: "allow-scripts",
        ...(resource.csp ? { csp: resource.csp } : {}),
        ...(resource.permissions ? { permissions: resource.permissions } : {}),
      });
    };
    const onInitialized = () => {
      clearTimeout(timer);
      bridge.current = host;
      setInitialized(true);
      ready();
    };
    const onSizeChange = ({ height }: { height?: number | undefined }) => {
      if (height !== undefined) setHeight(height);
    };
    host.addEventListener("sandboxready", onSandboxReady);
    host.addEventListener("initialized", onInitialized);
    host.addEventListener("sizechange", onSizeChange);
    host.onopenlink = async ({ url }) => (openLink(url) ? {} : { isError: true });
    host.onrequestdisplaymode = async () => ({ mode: "inline" });
    if (canCallTools) host.oncalltool = async ({ name, arguments: args }) => runTool({ name, ...(args ? { arguments: args } : {}) }, calls.signal);
    const start = async () => {
      try {
        await host.connect(new module.PostMessageTransport(target, target));
        if (!closed) setSrc(resource.sandbox);
      } catch {
        if (!closed) fail();
      }
    };
    void start();
    return () => {
      closed = true;
      calls.abort();
      clearTimeout(timer);
      host.removeEventListener("sandboxready", onSandboxReady);
      host.removeEventListener("initialized", onInitialized);
      host.removeEventListener("sizechange", onSizeChange);
      bridge.current = undefined;
      sent.current = { input: false, result: false };
      setInitialized(false);
      host.teardownResource({}, { timeout: 1000 }).then(
        () => host.close(),
        () => host.close(),
      );
    };
  }, [loaded, timeoutMs, canCallTools]);

  // The call's input once the view has started, and its result when the call has one.
  useEffect(() => {
    const host = bridge.current;
    if (!initialized || !host) return;
    if (!sent.current.input) {
      sent.current.input = true;
      const args = call.args && typeof call.args === "object" ? (call.args as Record<string, unknown>) : {};
      void host.sendToolInput({ arguments: args });
    }
    if (call.result !== undefined && !sent.current.result) {
      sent.current.result = true;
      void host.sendToolResult({ content: [{ type: "text", text: call.result }], ...(call.status === "failed" ? { isError: true } : {}) });
    }
  }, [initialized, call.args, call.result, call.status]);

  // The dashboard's theme, and the style variables that go with it, whenever it changes.
  useEffect(() => {
    if (initialized) bridge.current?.setHostContext(hostContext(dark));
  }, [initialized, dark]);

  return (
    <iframe
      ref={frame}
      title={call.summary}
      {...(src ? { src } : {})}
      // The proxy keeps its own origin, which the specification asks for; it holds no data of the dashboard's.
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      className={cn("block w-full border-0 bg-transparent", loaded?.resource.prefersBorder && "rounded-md border", height === undefined && "opacity-0")}
      // Until the view says how tall it is, the frame keeps one pixel: a frame of no size gets no animation frames.
      style={{ height: height ?? 1, colorScheme: dark ? "dark" : "light" }}
    />
  );
}

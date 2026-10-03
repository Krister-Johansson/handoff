import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { OpenLink } from "./dom";

type ToolResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean };

/** A tool's answer: its value, or the text that says why there is none. */
export type Outcome<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

/**
 * What the host lets a view do. `open` opens a link when the host lists openLinks; `call` calls one of handoff's
 * tools when the host lists serverTools. A write goes to the host as a request: the host may ask the person first,
 * and its refusal comes back as an error.
 */
export type ViewHost = { open?: OpenLink | undefined; call?: ((name: string, args: Record<string, unknown>) => Promise<Outcome>) | undefined };

/**
 * The value in a tool's result, or the text to show instead. handoff's tools answer with JSON in one text block,
 * which every client gets; the dashboard's assistant wraps results with text from runs or GitHub as { source, data }.
 */
export function valueOf(result: ToolResult, tool: string): Outcome {
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) return { ok: false, error: text || `${tool} failed.` };
  if (result.structuredContent !== undefined) return { ok: true, value: result.structuredContent };
  try {
    const value = JSON.parse(text) as unknown;
    const wrapped = value as { source?: unknown; data?: unknown } | null;
    return { ok: true, value: wrapped && typeof wrapped === "object" && typeof wrapped.source === "string" && "data" in wrapped ? wrapped.data : value };
  } catch {
    return { ok: false, error: text || `${tool} returned nothing to show.` };
  }
}

/** Takes the host's theme (light or dark), its style variables and its fonts, whichever it sends. */
function applyHostContext(context: McpUiHostContext | undefined) {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

export type ViewHandlers = {
  /** The tool's arguments, which the host sends when the model calls the tool, before its result. */
  input?: (args: Record<string, unknown>, host: ViewHost) => void;
  /** The tool's result. */
  result: (result: CallToolResult, host: ViewHost) => void;
};

/**
 * Starts a view as an MCP Apps view: it connects to the host (over postMessage to the parent frame unless given a
 * transport), follows the host's theme and hands the tool's input and result to the view's handlers.
 */
export async function startView(name: string, handlers: ViewHandlers, transport?: Transport): Promise<App> {
  const app = new App({ name: `handoff ${name}`, version: "1.0.0" });
  const open: OpenLink = async (url) => !(await app.openLink({ url })).isError;
  const call = async (tool: string, args: Record<string, unknown>): Promise<Outcome> => {
    try {
      return valueOf(await app.callServerTool({ name: tool, arguments: args }), tool);
    } catch (error) {
      return { ok: false, error: (error as Error).message || `The host did not run ${tool}.` };
    }
  };
  // Read once the host has said what it can do, which it does when the view connects.
  const host = (): ViewHost => {
    const can = app.getHostCapabilities();
    return { open: can?.openLinks ? open : undefined, call: can?.serverTools ? call : undefined };
  };
  app.ontoolinput = ({ arguments: args }) => handlers.input?.(args ?? {}, host());
  app.ontoolresult = (result) => handlers.result(result, host());
  app.onhostcontextchanged = applyHostContext;
  app.onteardown = async () => ({});
  await app.connect(transport);
  applyHostContext(app.getHostContext());
  return app;
}

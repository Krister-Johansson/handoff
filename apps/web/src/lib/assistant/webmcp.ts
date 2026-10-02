/// <reference types="webmcp-types" />
import { z } from "zod";
import { CATALOG, type ToolSpec } from "./catalog";
import type { PageToolSpec } from "./page-tools";
import { boundTools, type OpenPage, type PageToolOutcome } from "./run-page-tool";

/** What the page gives WebMCP: the approval card, the UI tools, the open page's tools, and the dashboard's tools route. */
export type WebMcpHost = {
  approve(call: { name: string; title: string; summary: string; args: unknown }): Promise<{ approved: boolean; note?: string }>;
  runUi(call: { name: string; args: unknown }): Promise<{ text: string; isError: boolean }>;
  /** Runs a page tool against the page that is open when the call arrives. */
  runPage(call: { name: string; args: unknown }): Promise<PageToolOutcome>;
  /** Called with what a browser agent is doing, and with undefined when it is done. */
  activity?(text: string | undefined): void;
  fetch?: typeof fetch;
};

/** The input as an object: Chrome before 155 could pass it as JSON text. */
const inputOf = (input: unknown) => (typeof input === "string" ? (JSON.parse(input) as unknown) : (input ?? {}));

function executeFor(spec: ToolSpec | PageToolSpec, host: WebMcpHost): WebMCP.ToolExecuteCallback {
  const call = async (args: unknown): Promise<string> => {
    if (spec.confirm) {
      const parsed = spec.input.safeParse(args);
      const answer = await host.approve({ name: spec.name, title: spec.title, summary: parsed.success ? spec.summarize(parsed.data) : spec.title, args });
      if (!answer.approved) return `The person did not approve this${answer.note ? `: ${/[.!?]$/.test(answer.note) ? answer.note : `${answer.note}.`}` : "."} Do not try it again.`;
    }
    // UI tools and the open page's tools run here, in the page; data tools through the dashboard's tools route.
    if (spec.kind === "ui" || spec.kind === "page") {
      const target = { name: spec.name, args };
      const result = await (spec.kind === "page" ? host.runPage(target) : host.runUi(target));
      if (result.isError) throw new Error(result.text);
      return result.text;
    }
    const response = await (host.fetch ?? fetch)(`/api/assistant/tools/${spec.name}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    const body = (await response.json().catch(() => ({}))) as { result?: unknown; error?: string };
    if (!response.ok) throw new Error(body.error ?? `The dashboard answered ${response.status}.`);
    return JSON.stringify(body.result);
  };
  return async (input) => {
    host.activity?.(`A browser agent is using ${spec.title}`);
    try {
      return await call(inputOf(input));
    } finally {
      host.activity?.(undefined);
    }
  };
}

/** A spec as WebMCP takes it: its JSON Schema, and annotations that let Chrome ask before a consequential tool runs. */
function toolFor(spec: ToolSpec | PageToolSpec, host: WebMcpHost): WebMCP.ModelContextTool {
  return {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input),
    annotations: { readOnlyHint: spec.readOnly, consequentialHint: spec.confirm, untrustedContentHint: spec.untrusted ?? false },
    execute: executeFor(spec, host),
  };
}

/**
 * Registers the catalog with the browser's WebMCP, so an agent in the browser can use handoff's tools
 * on any dashboard page: data tools through the dashboard's tools route, confirm tools only after the
 * person approves them on the page, UI tools in the page itself. Without the assistant only the read
 * and UI tools register. Aborting `signal` removes them. Resolves to how many tools registered.
 */
export async function registerWebMcp(context: WebMCP.ModelContext | undefined, host: WebMcpHost, options: { available: boolean; signal: AbortSignal }): Promise<number> {
  if (!context) return 0;
  const specs = CATALOG.filter((t) => options.available || (t.readOnly && !t.confirm));
  await Promise.all(specs.map((spec) => context.registerTool(toolFor(spec, host), { signal: options.signal })));
  return specs.length;
}

/**
 * Registers the tools the open page bound, beside the catalog, so a browser agent can use them as the
 * assistant does: in the page, and confirm tools only after the person approves them on the page.
 * Without the assistant the confirm tools stay out, since the panel cannot show their approval card.
 * Aborting `signal` removes them. A registration the browser rejects is left out, so a browser quirk
 * cannot break the page. Resolves to how many tools registered.
 */
export async function registerPageTools(
  context: WebMCP.ModelContext | undefined,
  page: OpenPage | undefined,
  host: WebMcpHost,
  options: { available: boolean; signal: AbortSignal },
): Promise<number> {
  if (!context || !page) return 0;
  const specs = boundTools(page).filter((spec) => options.available || !spec.confirm);
  const results = await Promise.allSettled(specs.map((spec) => context.registerTool(toolFor(spec, host), { signal: options.signal })));
  return results.filter((r) => r.status === "fulfilled").length;
}

/**
 * The open page's tools on WebMCP, one set at a time. `show` removes the set registered before it,
 * waits until that set has finished registering (the browser rejects a name it still holds), then
 * registers the page's bound tools; a `show` overtaken by a later one registers nothing. `clear`
 * removes the set.
 */
export function pageToolsOnWebMcp(context: WebMCP.ModelContext | undefined, host: WebMcpHost, options: { available: boolean }) {
  let controller: AbortController | undefined;
  let settled: Promise<unknown> = Promise.resolve();
  return {
    async show(page: OpenPage | undefined): Promise<number> {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      await settled;
      if (mine.signal.aborted) return 0;
      const registering = registerPageTools(context, page, host, { available: options.available, signal: mine.signal });
      settled = registering;
      return registering;
    },
    clear() {
      controller?.abort();
      controller = undefined;
    },
  };
}

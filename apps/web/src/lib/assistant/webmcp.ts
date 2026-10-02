/// <reference types="webmcp-types" />
import { z } from "zod";
import { CATALOG, type ToolSpec } from "./catalog";

/** What the page gives WebMCP: the approval card, the UI tools, and the dashboard's tools route. */
export type WebMcpHost = {
  approve(call: { name: string; title: string; summary: string; args: unknown }): Promise<{ approved: boolean; note?: string }>;
  runUi(call: { name: string; args: unknown }): Promise<{ text: string; isError: boolean }>;
  /** Called with what a browser agent is doing, and with undefined when it is done. */
  activity?(text: string | undefined): void;
  fetch?: typeof fetch;
};

/** The input as an object: Chrome before 155 could pass it as JSON text. */
const inputOf = (input: unknown) => (typeof input === "string" ? (JSON.parse(input) as unknown) : (input ?? {}));

function executeFor(spec: ToolSpec, host: WebMcpHost): WebMCP.ToolExecuteCallback {
  const call = async (args: unknown): Promise<string> => {
    if (spec.kind === "ui") {
      const result = await host.runUi({ name: spec.name, args });
      if (result.isError) throw new Error(result.text);
      return result.text;
    }
    if (spec.confirm) {
      const parsed = spec.input.safeParse(args);
      const answer = await host.approve({ name: spec.name, title: spec.title, summary: parsed.success ? spec.summarize(parsed.data) : spec.title, args });
      if (!answer.approved) return `The person did not approve this${answer.note ? `: ${/[.!?]$/.test(answer.note) ? answer.note : `${answer.note}.`}` : "."} Do not try it again.`;
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

/**
 * Registers the catalog with the browser's WebMCP, so an agent in the browser can use handoff's tools
 * on any dashboard page: data tools through the dashboard's tools route, confirm tools only after the
 * person approves them on the page, UI tools in the page itself. Without the assistant only the read
 * and UI tools register. Aborting `signal` removes them. Resolves to how many tools registered.
 */
export async function registerWebMcp(context: WebMCP.ModelContext | undefined, host: WebMcpHost, options: { available: boolean; signal: AbortSignal }): Promise<number> {
  if (!context) return 0;
  const specs = CATALOG.filter((t) => options.available || (t.readOnly && !t.confirm));
  await Promise.all(
    specs.map((spec) =>
      context.registerTool(
        {
          name: spec.name,
          title: spec.title,
          description: spec.description,
          inputSchema: z.toJSONSchema(spec.input),
          annotations: { readOnlyHint: spec.readOnly, consequentialHint: spec.confirm, untrustedContentHint: spec.untrusted ?? false },
          execute: executeFor(spec, host),
        },
        { signal: options.signal },
      ),
    ),
  );
  return specs.length;
}

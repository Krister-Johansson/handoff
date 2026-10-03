import { CATALOG } from "./catalog";

/** A tools/call from an MCP Apps view, as AppBridge hands it to the host. */
export type ViewToolCall = { name: string; arguments?: Record<string, unknown> | undefined };
/** The tool result the view gets back: the catalog tool's JSON as text, or the reason it did not run. */
export type ViewToolResult = { content: { type: "text"; text: string }[]; isError?: true };

/** What runs a view's call: the person's approval card, and the dashboard's tools route. */
export type ViewToolDeps = {
  approve(call: { name: string; title: string; summary: string; args: unknown }): Promise<{ approved: boolean; note?: string | undefined }>;
  run(name: string, args: unknown): Promise<unknown>;
};

const SERVER_TOOLS = new Map(CATALOG.filter((t) => t.kind === "data").map((t) => [t.name, t]));
const error = (text: string): ViewToolResult => ({ content: [{ type: "text", text }], isError: true });
const sentence = (note: string) => (/[.!?]$/.test(note) ? note : `${note}.`);

/**
 * Runs a tool a view calls, for any view and any of the catalog's server tools. The arguments must pass the
 * catalog's schema. A tool the catalog marks confirm goes to the person's approval card first: the click in the
 * view asks, the approval decides. The result is the tool's JSON as text, as handoff's MCP server returns it.
 */
export async function runViewTool(call: ViewToolCall, deps: ViewToolDeps): Promise<ViewToolResult> {
  const spec = SERVER_TOOLS.get(call.name);
  if (!spec) return error(`${call.name} is not a handoff tool a view can call.`);
  const args = call.arguments ?? {};
  const parsed = spec.input.safeParse(args);
  if (!parsed.success) return error(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  if (spec.confirm) {
    const answer = await deps.approve({ name: spec.name, title: spec.title, summary: spec.summarize(parsed.data), args });
    if (!answer.approved) return error(`The person did not approve this${answer.note ? `: ${sentence(answer.note)}` : "."}`);
  }
  try {
    return { content: [{ type: "text", text: JSON.stringify(await deps.run(spec.name, parsed.data), null, 2) }] };
  } catch (e) {
    return error((e as Error).message);
  }
}

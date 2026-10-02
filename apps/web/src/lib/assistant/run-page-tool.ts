import { PAGE_TOOLS, type PageKind, type PageToolSpec } from "./page-tools";

/** A page tool's handler: it acts in the page and says what it did, or throws to refuse. */
export type PageToolHandler = (args: never) => string | Promise<string>;

/** The page that is open now, as it registered: its kind, the handlers it bound and its state. */
export type OpenPage = {
  kind: PageKind;
  handlers: Readonly<Partial<Record<string, PageToolHandler>>>;
  describe(): unknown;
};

/**
 * The specs of the tools the page bound right now, in the kind's order. where_am_i lists them; the
 * turn (which tools to register for the model) and WebMCP (which to register in the browser) use the same list.
 */
export function boundTools(page: OpenPage): PageToolSpec[] {
  return PAGE_TOOLS[page.kind].filter((spec) => page.handlers[spec.name]);
}

/** What a page tool call did: the text for the model, and whether it is an error. */
export type PageToolOutcome = { text: string; isError: boolean };

/** Runs a page tool against the page that is open now: checks the arguments with the tool's input, then runs its handler. */
export async function runPageTool(page: OpenPage | undefined, call: { name: string; args: unknown }): Promise<PageToolOutcome> {
  const spec = page && PAGE_TOOLS[page.kind].find((t) => t.name === call.name);
  const handler = spec && (page.handlers[call.name] as ((args: unknown) => string | Promise<string>) | undefined);
  if (!spec || !handler) {
    // The person navigated, or the model called a tool of a page it left earlier in the turn.
    const here = `${window.location.pathname}${window.location.search}`;
    return { text: `The page changed: the person is now on ${here} (${page?.kind ?? "a page without tools"}). ${call.name} is not available here. Call where_am_i.`, isError: true };
  }
  const parsed = spec.input.safeParse(call.args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; ");
    return { text: `The arguments for ${call.name} are not valid: ${issues}`, isError: true };
  }
  try {
    return { text: await handler(parsed.data), isError: false };
  } catch (error) {
    return { text: error instanceof Error && error.message ? error.message : `The page could not run ${call.name}.`, isError: true };
  }
}

import { PAGE_TOOLS, type PageKind, type PageToolSpec } from "./page-tools";

/** A page tool's handler: it acts in the page and says what it did, or throws to refuse. */
export type PageToolHandler = (args: never) => string | Promise<string>;

/** A page tool's check: why the page would refuse the call now, or undefined. It changes nothing. */
export type PageToolCheck = (args: never) => string | undefined;

/** The page that is open now, as it registered: its kind, the handlers it bound, their checks and its state. */
export type OpenPage = {
  kind: PageKind;
  handlers: Readonly<Partial<Record<string, PageToolHandler>>>;
  checks?: Readonly<Partial<Record<string, PageToolCheck>>>;
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

type Prepared = { handler: (args: unknown) => string | Promise<string>; args: unknown } | { refused: PageToolOutcome };

/** Finds a page tool on the page that is open now and checks its arguments with the tool's input. */
function prepare(page: OpenPage | undefined, call: { name: string; args: unknown }): Prepared {
  const spec = page && PAGE_TOOLS[page.kind].find((t) => t.name === call.name);
  const handler = spec && (page.handlers[call.name] as ((args: unknown) => string | Promise<string>) | undefined);
  if (!spec || !handler) {
    // The person navigated, or the model called a tool of a page it left earlier in the turn.
    const here = `${window.location.pathname}${window.location.search}`;
    return { refused: { text: `The page changed: the person is now on ${here} (${page?.kind ?? "a page without tools"}). ${call.name} is not available here. Call where_am_i.`, isError: true } };
  }
  const parsed = spec.input.safeParse(call.args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.length ? `${i.path.join(".")}: ` : ""}${i.message}`).join("; ");
    return { refused: { text: `The arguments for ${call.name} are not valid: ${issues}`, isError: true } };
  }
  return { handler, args: parsed.data };
}

/** Runs a page tool against the page that is open now: checks the arguments with the tool's input, then runs its handler. */
export async function runPageTool(page: OpenPage | undefined, call: { name: string; args: unknown }): Promise<PageToolOutcome> {
  const prepared = prepare(page, call);
  if ("refused" in prepared) return prepared.refused;
  try {
    return { text: await prepared.handler(prepared.args), isError: false };
  } catch (error) {
    return { text: error instanceof Error && error.message ? error.message : `The page could not run ${call.name}.`, isError: true };
  }
}

/**
 * Asks the page that is open now whether it would refuse a page tool call, without running it: the
 * check's reason as an error, or that the call can run. The turn asks before the call's card goes up.
 */
export function checkPageTool(page: OpenPage | undefined, call: { name: string; args: unknown }): PageToolOutcome {
  const prepared = prepare(page, call);
  if ("refused" in prepared) return prepared.refused;
  const check = page?.checks?.[call.name] as ((args: unknown) => string | undefined) | undefined;
  const refusal = check?.(prepared.args);
  return refusal ? { text: refusal, isError: true } : { text: `${call.name} can run on this page.`, isError: false };
}

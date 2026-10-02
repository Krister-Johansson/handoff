import { boundTools, type OpenPage } from "./run-page-tool";
import { planUiTool, UiToolError } from "./ui-tools";

/** What a UI tool call did in the page: the text for the model, and for a navigation, what the panel says. */
export type UiToolOutcome = { text: string; isError: boolean; note?: string };

const heading = () => document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("h1");
/** The heading's title: the page header marks it, so a count beside it is left out. */
const headingText = (h: HTMLElement | null) => (h?.querySelector("[data-page-title]") ?? h)?.textContent?.trim() ?? "";
const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * Waits until the page shows: the address is `href`, or it left the old page for another (the server
 * redirects /runs/<id> to the run under its project), and the heading changed. A tab or filter change
 * keeps the page and its heading, so there the address alone counts. Gives up after `timeoutMs`.
 */
async function pageShown(href: string, before: { path: string; heading: HTMLElement | null; text: string }, timeoutMs: number) {
  const target = new URL(href, window.location.origin);
  const exact = `${target.pathname}${target.search}`;
  const samePage = target.pathname === new URL(before.path, window.location.origin).pathname;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = here();
    if (samePage && now === exact) return heading();
    if (!samePage && now !== before.path) {
      const h = heading();
      if (h && (h !== before.heading || headingText(h) !== before.text)) return h;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

/**
 * Runs one of the catalog's UI tools in the page. A navigation pushes the route, waits for the page,
 * moves focus to its heading and says where it went; where_am_i describes the open page.
 */
export async function runUiTool(
  call: { name: string; args: unknown },
  { push, page, timeoutMs = 10_000 }: { push: (href: string) => void; page?: () => OpenPage | undefined; timeoutMs?: number },
): Promise<UiToolOutcome> {
  let plan;
  try {
    plan = planUiTool(call.name, call.args, window.location.origin);
  } catch (error) {
    return { text: error instanceof UiToolError ? error.message : `The page could not run ${call.name}.`, isError: true };
  }
  if (plan.kind === "where") {
    const open = page?.();
    const where = { path: here(), title: document.title, heading: headingText(heading()) };
    if (!open) return { text: JSON.stringify(where), isError: false };
    const tools = boundTools(open).map((spec) => ({ name: spec.name, title: spec.title }));
    return { text: JSON.stringify({ ...where, page: { kind: open.kind, tools } }), isError: false };
  }
  const before = { path: here(), heading: heading(), text: headingText(heading()) };
  push(plan.href);
  const shown = await pageShown(plan.href, before, timeoutMs);
  if (!shown) return { text: `Went to ${plan.href}, but the page has not finished loading.`, isError: false, note: `Went to ${plan.href}` };
  if (shown.tabIndex < 0 && !shown.hasAttribute("tabindex")) shown.setAttribute("tabindex", "-1");
  shown.focus();
  const name = headingText(shown) || plan.href;
  return { text: `Opened ${name} (${here()}).`, isError: false, note: `Opened ${name}` };
}

import { planUiTool, UiToolError } from "./ui-tools";

/** What a UI tool call did in the page: the text for the model, and for a navigation, what the panel says. */
export type UiToolOutcome = { text: string; isError: boolean; note?: string };

const heading = () => document.querySelector<HTMLElement>("main h1") ?? document.querySelector<HTMLElement>("h1");
/** The heading's title: the page header marks it, so a count beside it is left out. */
const headingText = (h: HTMLElement | null) => (h?.querySelector("[data-page-title]") ?? h)?.textContent?.trim() ?? "";
const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * Waits until the address is `href` and the page shows it: the heading changed, or the path stayed the
 * same (a tab or filter change keeps the page and its heading). Gives up after `timeoutMs`.
 */
async function pageShown(href: string, before: { path: string; heading: HTMLElement | null; text: string }, timeoutMs: number) {
  const target = new URL(href, window.location.origin);
  const samePage = target.pathname === new URL(before.path, window.location.origin).pathname;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (here() === `${target.pathname}${target.search}`) {
      const h = heading();
      if (samePage || (h && (h !== before.heading || headingText(h) !== before.text))) return h;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
}

/**
 * Runs one of the catalog's UI tools in the page. A navigation pushes the route, waits for the page,
 * moves focus to its heading and says where it went; where_am_i describes the open page.
 */
export async function runUiTool(call: { name: string; args: unknown }, push: (href: string) => void, timeoutMs = 10_000): Promise<UiToolOutcome> {
  let plan;
  try {
    plan = planUiTool(call.name, call.args, window.location.origin);
  } catch (error) {
    return { text: error instanceof UiToolError ? error.message : `The page could not run ${call.name}.`, isError: true };
  }
  if (plan.kind === "where") {
    return { text: JSON.stringify({ path: here(), title: document.title, heading: headingText(heading()) }), isError: false };
  }
  const before = { path: here(), heading: heading(), text: headingText(heading()) };
  push(plan.href);
  const shown = await pageShown(plan.href, before, timeoutMs);
  if (!shown) return { text: `Went to ${plan.href}, but the page has not finished loading.`, isError: false, note: `Went to ${plan.href}` };
  if (shown.tabIndex < 0 && !shown.hasAttribute("tabindex")) shown.setAttribute("tabindex", "-1");
  shown.focus();
  const name = headingText(shown) || plan.href;
  return { text: `Opened ${name} (${plan.href}).`, isError: false, note: `Opened ${name}` };
}

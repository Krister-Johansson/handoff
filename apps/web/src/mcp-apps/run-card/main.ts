import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { renderRunCard, renderState, runOfResult, type OpenLink } from "./view";

/** Takes the host's theme (light or dark), its style variables and its fonts, whichever it sends. */
function applyHostContext(context: McpUiHostContext | undefined) {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
}

/**
 * Starts the run card in `root` as an MCP Apps view: it connects to the host (over postMessage to the parent
 * frame unless given a transport), follows the host's theme and draws get_run's result when the host sends it.
 */
export async function startRunCard(root: HTMLElement, transport?: Transport): Promise<App> {
  const app = new App({ name: "handoff run card", version: "1.0.0" });
  // The host opens links only when it says so in its capabilities (ui/open-link); otherwise links are plain links.
  const open: OpenLink = async (url) => !(await app.openLink({ url })).isError;
  const opener = () => (app.getHostCapabilities()?.openLinks ? open : undefined);

  renderState(root, "Loading the run…");
  app.ontoolinput = ({ arguments: args }) => {
    const id = typeof args?.run_id === "string" ? args.run_id.slice(0, 8) : undefined;
    renderState(root, id ? `Loading run ${id}…` : "Loading the run…");
  };
  app.ontoolresult = (result) => {
    const shown = runOfResult(result);
    if ("run" in shown) renderRunCard(root, shown.run, opener());
    else renderState(root, shown.error, true);
  };
  app.onhostcontextchanged = applyHostContext;
  app.onteardown = async () => ({});

  await app.connect(transport);
  applyHostContext(app.getHostContext());
  return app;
}

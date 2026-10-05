import type { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/client";
import { startView } from "../shared/app";
import { renderState } from "../shared/dom";
import { renderRunCard, runOfResult } from "./view";

/**
 * Starts the run card in `root` as an MCP Apps view: it connects to the host (over postMessage to the parent
 * frame unless given a transport), follows the host's theme and draws get_run's result when the host sends it.
 */
export function startRunCard(root: HTMLElement, transport?: Transport): Promise<App> {
  renderState(root, "Loading the run…");
  return startView(
    "run card",
    {
      input: (args) => {
        const id = typeof args.run_id === "string" ? args.run_id.slice(0, 8) : undefined;
        renderState(root, id ? `Loading run ${id}…` : "Loading the run…");
      },
      result: (result, host) => {
        const shown = runOfResult(result);
        if ("run" in shown) renderRunCard(root, shown.run, host);
        else renderState(root, shown.error, true);
      },
    },
    transport,
  );
}

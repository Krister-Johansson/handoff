import type { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { startView, valueOf, type ViewHost } from "../shared/app";
import { renderState } from "../shared/dom";
import { isInbox, readInbox } from "../shared/inbox";
import { addDetails, isAttention, renderNeedsYou, type AttentionItem } from "./view";

/** list_attention gives a permission or a question without its details; list_inbox, a read, has them. */
async function withDetails(root: HTMLElement, items: AttentionItem[], host: ViewHost) {
  if (!items.some((i) => i.kind === "permission" || i.kind === "question")) return;
  const inbox = await readInbox(host);
  if (inbox) addDetails(root, inbox, host);
}

/** Starts the Needs you list in `root` as an MCP Apps view of list_inbox and list_attention. */
export function startNeedsYou(root: HTMLElement, transport?: Transport): Promise<App> {
  renderState(root, "Loading what needs you…");
  return startView(
    "needs you",
    {
      result: (result, host) => {
        const shown = valueOf(result, "The list");
        if (!shown.ok) return renderState(root, shown.error, true);
        if (isInbox(shown.value)) return renderNeedsYou(root, shown.value, host);
        if (!isAttention(shown.value)) return renderState(root, "The list has nothing this view can show.", true);
        renderNeedsYou(root, shown.value, host);
        void withDetails(root, shown.value, host);
      },
    },
    transport,
  );
}

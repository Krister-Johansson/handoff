import type { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/client";
import { say, statusLine } from "../shared/act";
import { startView, valueOf, type Outcome, type ViewHost } from "../shared/app";
import { cardActions, decisionText, openRun, permissionHead, type PermissionData } from "../shared/cards";
import { dotted, el } from "../shared/dom";
import { permissionOf, readInbox } from "../shared/inbox";

type Asked = { request_id?: unknown; decision?: unknown; message?: unknown };
type State = { asked?: Asked; request?: PermissionData; outcome?: Outcome };

/**
 * answer_permission's card: the request it answers, with the step, what it asks and the whole command while the
 * Inbox still has it, the decision pending until the result comes back, then the decision or why it failed.
 */
function render(root: HTMLElement, state: State, host: ViewHost) {
  const { asked, request, outcome } = state;
  const deny = asked?.decision === "deny";
  const title = request ? `${request.node} ${request.asks}` : "Permission request";
  const status = statusLine();
  if (!outcome) say(status, deny ? "Denying…" : "Allowing once…", "pending");
  else if (outcome.ok) say(status, decisionText(String((outcome.value as { decision?: unknown } | null)?.decision ?? asked?.decision)));
  else say(status, outcome.error, "error");
  const url = (outcome?.ok ? (outcome.value as { url?: unknown } | null)?.url : undefined) ?? request?.url;
  const card = el(
    "article",
    "ic pc",
    permissionHead(title),
    request && (request.project || request.run) && dotted("ic-c", [request.project, request.run && el("span", "trunc", request.run)]),
    request?.detail && el("pre", "term", request.detail),
    deny && typeof asked?.message === "string" && asked.message && el("p", "note", `Note: ${asked.message}`),
    status,
    cardActions(openRun(typeof url === "string" ? url : undefined, host)),
  );
  card.setAttribute("aria-label", title);
  root.replaceChildren(card);
}

/** Starts the permission card in `root` as an MCP Apps view of answer_permission. */
export function startPermissionCard(root: HTMLElement, transport?: Transport): Promise<App> {
  const state: State = {};
  return startView(
    "permission card",
    {
      input: (args, host) => {
        state.asked = args as Asked;
        render(root, state, host);
        // The request leaves the Inbox once it is answered, so its details come from there while the answer is pending.
        void readInbox(host).then((inbox) => {
          const found = inbox?.permissions.find((p) => p.id === state.asked?.request_id);
          if (!found) return;
          state.request = permissionOf(found);
          render(root, state, host);
        });
      },
      result: (result, host) => {
        state.outcome = valueOf(result, "answer_permission");
        render(root, state, host);
      },
    },
    transport,
  );
}

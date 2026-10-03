/**
 * The Inbox's cards as the views draw them (components/inbox/cards.tsx and components/runs/permission-card.tsx):
 * an icon tile in the item's tone beside what it is about, what it asks and what to do. The permission card and
 * the question card answer inline through the host's tool calls when the host proxies them.
 */
import { act, say, statusLine } from "./act";
import type { ViewHost } from "./app";
import { button, dotted, el, icon, ICONS, link, type Child } from "./dom";

export type Tone = "neutral" | "active" | "attention" | "danger" | "success";

/** What the cards say about the run an item belongs to: its project, its task and its dashboard page. */
export type RunRef = { project?: string | undefined; run?: string | undefined; url?: string | undefined };

/** A card: the tile, then the body. Its accessible name is its title. */
export function inboxCard(paths: string[], tone: Tone, title: string, ...body: Child[]) {
  const tile = el("span", `tile t-${tone}`, icon(paths));
  tile.setAttribute("aria-hidden", "true");
  const card = el("article", "ic", tile, el("div", "ic-b", ...body));
  card.setAttribute("aria-label", title);
  return card;
}

/** The line above a card's title: what kind of item it is, then its project and run, and the node it came from. */
export function cardContext(tag: string, tone: Tone, item: RunRef, node?: string) {
  return dotted("ic-c", [el("span", `tag t-${tone}`, tag), item.project, item.run && el("span", "trunc", item.run), node && el("span", "mono", node)]);
}

export const cardTitle = (text: Child, mono = false) => el("h4", mono ? "ic-t mono" : "ic-t", text);

export const openRun = (url: string | undefined, host: ViewHost) => url && link(url, "btn btn-ghost", host.open, "Open the run");

export const cardActions = (...children: Child[]) => el("div", "ic-a", ...children);

/** A permission request as get_run and list_inbox give it. */
export type PermissionData = RunRef & { id: string; node: string; asks: string; detail?: string | null | undefined; input?: unknown };

/** The pending text and the outcome of each decision. */
const DECISION = { allow: { pending: "Allowing once…", done: "Allowed once." }, deny: { pending: "Denying…", done: "Denied." } } as const;
export const decisionText = (decision: string) => (decision === "allowed" || decision === "allow" ? DECISION.allow.done : DECISION.deny.done);

/** The permission card's head: its shield tile and the step with what it asks. */
export function permissionHead(title: string) {
  const tile = el("span", "tile t-attention", icon(ICONS.shield));
  tile.setAttribute("aria-hidden", "true");
  return el("div", "pc-h", tile, el("h4", "ic-t", title));
}

/**
 * A tool call a step's allow rules do not cover, while the step waits for an answer: what it wants to do, the whole
 * command, the full input folded away when it is known, and Allow once or Deny with a note. Always allow is only in
 * the dashboard, as answer_permission's description says.
 */
export function permissionCard(p: PermissionData, host: ViewHost) {
  const title = `${p.node} ${p.asks}`;
  const status = statusLine();
  const card = el(
    "article",
    "ic pc",
    permissionHead(title),
    (p.project || p.run) && dotted("ic-c", [p.project, p.run && el("span", "trunc", p.run)]),
    el("p", "muted", "The step waits for your answer. Its allow rules do not cover this call."),
    p.detail && el("pre", "term", p.detail),
    p.input !== undefined && el("details", "full", el("summary", undefined, "Full input"), el("pre", "term", JSON.stringify(p.input, null, 2))),
  );
  card.setAttribute("aria-label", title);
  if (host.call) {
    const call = host.call;
    const noteId = `note-${p.id}`;
    const note = el("input", "input");
    note.id = noteId;
    note.placeholder = "Why not, or what to do instead";
    // Enter would answer with the first button, Allow once.
    note.addEventListener("keydown", (event) => event.key === "Enter" && event.preventDefault());
    const label = el("label", "label", "Note for Claude (optional)");
    label.htmlFor = noteId;
    const form = el("div", "form", el("div", "field", label, note));
    const answer = (decision: "allow" | "deny") => {
      const message = note.value.trim();
      const args = { request_id: p.id, decision, ...(decision === "deny" && message ? { message } : {}) };
      void act(form, status, DECISION[decision].pending, () => call("answer_permission", args), () => {
        form.remove();
        say(status, DECISION[decision].done);
      });
    };
    form.append(cardActions(button("Allow once", "btn btn-primary", () => answer("allow")), button("Deny", "btn btn-outline", () => answer("deny"))));
    card.append(form);
  }
  card.append(status, cardActions(openRun(p.url, host)));
  return card;
}

/** A question as get_run and list_inbox give it: a review or a Try it gate links to its page. */
export type QuestionData = RunRef & { id: string; node?: string | undefined; question: string; options: string[]; review_url?: string | undefined; try_url?: string | undefined };

/** A Paths question's options, labelled as its card in the dashboard labels them (components/runs/paths-question-card.tsx). */
const PATHS: Record<string, string> = { allow: "Allow for this run", send_back: "Send back", fail: "Fail the step" };
const isPaths = (options: string[]) => options.length === 3 && options.every((o) => o in PATHS);

/** Options that turn the work back or away get the quieter button. */
const quiet = (option: string) => ["abort", "reject", "changes", "send_back", "fail"].includes(option);

/** A question a run asked: a review opens on its page, a Try it gate on its own, any other is answered here. */
export function questionCard(q: QuestionData, host: ViewHost) {
  if (q.review_url) {
    return inboxCard(ICONS.review, "attention", q.question, cardContext("Approval requested", "attention", q), cardTitle(q.question), cardActions(link(q.review_url, "btn btn-primary", host.open, "Open the review"), openRun(q.url, host)));
  }
  if (q.try_url) {
    return inboxCard(ICONS.play, "attention", q.question, cardContext("Try the app", "attention", q, q.node), cardTitle(q.question), cardActions(link(q.try_url, "btn btn-primary", host.open, "Open Try it")));
  }
  const status = statusLine();
  const card = inboxCard(ICONS.question, "active", q.question, cardContext("A node asked a question", "active", q, q.node), cardTitle(q.question));
  const body = card.querySelector(".ic-b")!;
  if (host.call) {
    const call = host.call;
    const fieldId = `answer-${q.id}`;
    const text = el("textarea", "input");
    text.id = fieldId;
    text.rows = 2;
    text.placeholder = "Your answer goes to the node that asked.";
    const label = el("label", "label", q.options.length ? "Details (optional)" : "Answer");
    label.htmlFor = fieldId;
    const form = el("div", "form");
    const send = (option?: string) => {
      const answer = text.value.trim() || option;
      if (!answer) {
        say(status, "Pick an option or write an answer.", "error");
        return;
      }
      const args = { question_id: q.id, answer, ...(option ? { option } : {}) };
      void act(form, status, "Sending the answer…", () => call("answer_question", args), () => {
        form.remove();
        say(status, `Answered: ${option ?? answer}`);
      });
    };
    const labels = isPaths(q.options) ? PATHS : {};
    if (q.options.length) form.append(el("div", "ic-a", ...q.options.map((o) => button(labels[o] ?? o, quiet(o) ? "btn btn-outline wrap" : "btn btn-primary wrap", () => send(o)))));
    form.append(el("div", "field", label, text));
    if (!q.options.length) form.append(cardActions(button("Send answer", "btn btn-primary", () => send())));
    body.append(form);
  } else if (q.options.length) {
    body.append(el("p", "muted", `Options: ${q.options.join(", ")}`));
  }
  body.append(status, cardActions(openRun(q.url, host)));
  return card;
}

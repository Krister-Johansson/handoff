/**
 * The Needs you list: what waits on the person across projects, as list_inbox or list_attention gives it, in the
 * Inbox's groups (components/inbox/inbox-sections.tsx) with the Inbox's cards (components/inbox/cards.tsx).
 * Permissions and questions are answered inline, and a finished or failed run from list_attention is dismissed.
 */
import { act, say, statusLine } from "../shared/act";
import type { ViewHost } from "../shared/app";
import { cardActions, cardContext, cardTitle, inboxCard, openRun, permissionCard, questionCard } from "../shared/cards";
import { button, el, ICONS, link, plural } from "../shared/dom";
import { permissionOf, questionOf, reviewOf, type Inbox } from "../shared/inbox";

type Ref = { url: string };
export type AttentionItem = { id: string; kind: string; title: string; body: string; url: string };

export const isAttention = (value: unknown): value is AttentionItem[] => Array.isArray(value) && value.every((i) => typeof i === "object" && i !== null && typeof (i as AttentionItem).kind === "string");

const CI: Record<string, string> = { success: "CI passing", failure: "CI failing" };

type Group = { id: string; title: string; cards: HTMLElement[] };

/** The Inbox's groups for list_inbox's answer, in its order. */
function inboxGroups(inbox: Inbox, host: ViewHost): Group[] {
  return [
    { id: "permissions", title: "Permission requests", cards: inbox.permissions.map((p) => permissionCard(permissionOf(p), host)) },
    { id: "reviews", title: "Reviews to open", cards: inbox.reviews.map((q) => questionCard(reviewOf(q), host)) },
    { id: "questions", title: "Questions to answer", cards: inbox.questions.map((q) => questionCard(questionOf(q), host)) },
    {
      id: "ready",
      title: "Ready to merge",
      cards: inbox.ready_to_merge.map((r) => {
        const title = r.pr === null ? r.run : `#${r.pr} ${r.run}`;
        return inboxCard(
          ICONS.merge,
          "success",
          title,
          cardContext("Ready to merge", "neutral", r),
          cardTitle(title),
          el("p", "note", "First in the merge queue. It is brought up to date with main before it merges."),
          cardActions(openRun(r.url, host)),
        );
      }),
    },
    {
      id: "stopped",
      title: "Runs that stopped",
      cards: [
        ...inbox.failed_runs.map((f) => inboxCard(ICONS.failed, "danger", f.run, cardContext(`failed at ${f.node}`, "danger", f), cardTitle(f.run), cardActions(openRun(f.url, host)))),
        ...inbox.stuck_runs.map((s) => {
          const title = `${s.node} sent the work back ${s.attempts} times, as often as ${s.loop} allows.`;
          return inboxCard(ICONS.loop, "attention", title, cardContext("ran out of rounds", "attention", s), cardTitle(title), el("p", "note", "No step failed. Open the run to decide how to go on."), cardActions(openRun(s.url, host)));
        }),
      ],
    },
    {
      id: "pulls",
      title: "Pull requests waiting for your review",
      cards: inbox.pull_requests.map((p) => {
        const title = `#${p.pr} ${p.run}`;
        const ci = p.ci ? CI[p.ci] : undefined;
        return inboxCard(
          ICONS.pull,
          "success",
          title,
          cardContext("PR to review on GitHub", "neutral", p),
          cardTitle(title),
          el("p", "note", ci && el("span", `ci ci-${p.ci}`, ci), "The run goes on once the PR is approved."),
          cardActions(p.pr_url && link(p.pr_url, "btn btn-primary", host.open, "Review on GitHub"), openRun(p.url, host)),
        );
      }),
    },
  ];
}

/** Where each kind of list_attention item goes among the Inbox's groups; finished runs get a group of their own. */
const ATTENTION_GROUPS: { id: string; title: string; of: (i: AttentionItem) => boolean }[] = [
  { id: "permissions", title: "Permission requests", of: (i) => i.kind === "permission" },
  { id: "reviews", title: "Reviews to open", of: (i) => i.kind === "question" && /\/review\/[^/]+$/.test(i.url) },
  { id: "questions", title: "Questions to answer", of: (i) => i.kind === "question" && !/\/review\/[^/]+$/.test(i.url) },
  { id: "stopped", title: "Runs that stopped", of: (i) => i.kind === "failed" },
  { id: "pulls", title: "Pull requests waiting for your review", of: (i) => i.kind === "review" },
  { id: "finished", title: "Finished runs", of: (i) => i.kind === "finished" },
];

const KIND: Record<string, { paths: string[]; tone: "attention" | "active" | "danger" | "success"; tag: string }> = {
  permission: { paths: ICONS.shield, tone: "attention", tag: "Permission request" },
  question: { paths: ICONS.question, tone: "active", tag: "Question" },
  failed: { paths: ICONS.failed, tone: "danger", tag: "Stopped" },
  review: { paths: ICONS.pull, tone: "success", tag: "PR to review on GitHub" },
  finished: { paths: ICONS.check, tone: "success", tag: "Finished" },
};

/** A list_attention item: its title and body, Dismiss for a finished or failed run, and its run. */
function attentionCard(item: AttentionItem, host: ViewHost) {
  const kind = KIND[item.kind] ?? { paths: ICONS.question, tone: "active" as const, tag: item.kind };
  const status = statusLine();
  const actions = cardActions();
  if (host.call && (item.kind === "finished" || item.kind === "failed")) {
    const call = host.call;
    actions.append(
      button("Dismiss", "btn btn-outline", () =>
        void act(actions, status, "Dismissing…", () => call("dismiss_attention", { item_id: item.id }), () => {
          actions.querySelector("button")?.remove();
          say(status, "Dismissed.");
        }),
      ),
    );
  }
  actions.append(openRun(item.url, host) || "");
  return inboxCard(kind.paths, kind.tone, item.title, el("div", "ic-c", el("span", `tag t-${kind.tone}`, kind.tag)), cardTitle(item.title), item.body && el("p", "note", item.body), actions, status);
}

/** list_attention's items in the Inbox's groups, each card marked with its item's id. */
function attentionGroups(items: AttentionItem[], host: ViewHost): Group[] {
  const card = (item: AttentionItem) => {
    const shown = attentionCard(item, host);
    shown.dataset.item = item.id;
    return shown;
  };
  return ATTENTION_GROUPS.map((g) => ({ id: g.id, title: g.title, cards: items.filter(g.of).map(card) }));
}

/**
 * Gives list_attention's permissions and questions their cards with buttons, from `inbox` (list_inbox, read for
 * their details). An item the Inbox no longer has keeps its title and body.
 */
export function addDetails(root: HTMLElement, inbox: Inbox, host: ViewHost) {
  // The cards by list_attention's item id: permission:<id> for a permission, question:<id> for a question or a review.
  const cards = new Map<string, () => HTMLElement>([
    ...inbox.permissions.map((p) => [`permission:${p.id}`, () => permissionCard(permissionOf(p), host)] as const),
    ...inbox.questions.map((q) => [`question:${q.id}`, () => questionCard(questionOf(q), host)] as const),
    ...inbox.reviews.map((q) => [`question:${q.id}`, () => questionCard(reviewOf(q), host)] as const),
  ]);
  for (const shown of root.querySelectorAll<HTMLElement>("[data-item]")) {
    const card = cards.get(shown.dataset.item!);
    if (card) shown.replaceWith(card());
  }
}

/** The address of the dashboard's Inbox, from any item's dashboard address. */
function inboxUrl(urls: string[]) {
  for (const url of urls) {
    try {
      const at = new URL(url);
      if (at.pathname.startsWith("/projects/")) return `${at.origin}/inbox`;
    } catch {
      // Not an address: try the next.
    }
  }
  return undefined;
}

const urlsOf = (value: Inbox | AttentionItem[]) => (Array.isArray(value) ? value.map((i) => i.url) : Object.values(value).flatMap((items: Ref[]) => items.map((i) => i.url)));

/** Draws the list into `root`: list_inbox's groups, or list_attention's items. */
export function renderNeedsYou(root: HTMLElement, value: Inbox | AttentionItem[], host: ViewHost) {
  const groups = (Array.isArray(value) ? attentionGroups(value, host) : inboxGroups(value, host)).filter((g) => g.cards.length > 0);
  const count = groups.reduce((n, g) => n + g.cards.length, 0);
  const inboxAt = inboxUrl(urlsOf(value));
  const list = el(
    "section",
    "ny",
    el("div", "ny-h", el("h2", undefined, "Needs you"), el("span", "count", plural(count, "item")), inboxAt && link(inboxAt, "more", host.open, "Open the Inbox")),
  );
  list.setAttribute("aria-label", "Needs you");
  if (count === 0) {
    list.append(el("div", "empty", el("p", "empty-t", "Nothing needs you"), el("p", "muted", "Reviews, questions, runs that stopped and pull requests to review show up here.")));
  }
  for (const group of groups) {
    const heading = el("h3", "ny-g", group.title, el("span", "count-n", String(group.cards.length)));
    heading.id = `ny-${group.id}`;
    const section = el("section", "ny-s", heading, ...group.cards);
    section.setAttribute("aria-labelledby", heading.id);
    list.append(section);
  }
  root.replaceChildren(list);
}

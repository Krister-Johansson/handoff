import { expect, test } from "vitest";
import { z } from "zod";
import { CATALOG } from "./catalog";
import { PAGE_KINDS, PAGE_TOOLS, parseNodePatch } from "./page-tools";

const all = () => PAGE_KINDS.flatMap((kind) => PAGE_TOOLS[kind]);

test("every page tool has a page_ name within the rule, a title, a description and an input the browser can register as JSON Schema", () => {
  expect([...PAGE_KINDS].sort()).toEqual(["code_review", "graph_editor", "inbox", "plan_review", "run", "try"]);
  for (const kind of PAGE_KINDS) {
    const tools = PAGE_TOOLS[kind];
    expect(tools.length, kind).toBeGreaterThan(0);
    expect(new Set(tools.map((t) => t.name)).size, `${kind} has a name twice`).toBe(tools.length);
  }
  for (const spec of all()) {
    expect(spec.name).toMatch(/^page_[a-z][a-z0-9_]*$/);
    expect(spec.name.length).toBeLessThanOrEqual(48);
    expect(spec.kind).toBe("page");
    expect(spec.title.length).toBeGreaterThan(3);
    expect(spec.description.length).toBeGreaterThan(20);
    expect(z.toJSONSchema(spec.input)).toMatchObject({ type: "object" });
  }
});

test("a name shared by two pages has the same title, input and confirm", () => {
  const first = new Map<string, { kind: string; title: string; input: unknown; confirm: boolean }>();
  for (const kind of PAGE_KINDS) {
    for (const spec of PAGE_TOOLS[kind]) {
      const seen = { kind, title: spec.title, input: z.toJSONSchema(spec.input), confirm: spec.confirm };
      const earlier = first.get(spec.name);
      if (earlier) expect({ ...seen, kind: earlier.kind }, `${spec.name} on ${kind} and ${earlier.kind}`).toEqual(earlier);
      else first.set(spec.name, seen);
    }
  }
});

test("no page tool name is a catalog name", () => {
  const catalog = new Set(CATALOG.map((t) => t.name));
  expect(all().filter((t) => catalog.has(t.name)).map((t) => t.name)).toEqual([]);
});

test("confirm page tools are exactly the ones that submit, restart the app or save the graph", () => {
  const confirm = [...new Set(all().filter((t) => t.confirm).map((t) => t.name))].sort();
  expect(confirm).toEqual(["page_restart_app", "page_save_graph", "page_submit", "page_submit_review"]);
  for (const spec of all()) if (spec.confirm) expect(spec.readOnly, spec.name).toBe(false);
  expect(PAGE_TOOLS.try.find((t) => t.name === "page_submit")!.summarize({ option: "changes", note: "the list is empty after a reload" })).toBe(
    "Send the app back to the coder: the list is empty after a reload",
  );
  expect(PAGE_TOOLS.code_review.find((t) => t.name === "page_submit_review")!.summarize({ option: "fix" })).toBe("Approve after fixes, sending the comments back");
});

test("page_update_node takes a PR node's review comment settings as the inspector shows them, with no wait of its own for bots", () => {
  const settings = { reply: true, resolveAfterReview: false, summary: "coderabbitai", returnOnAnswerOnly: false, personWaitHours: 8, maxPerRound: 10 };
  expect(parseNodePatch("pr", "pr", { sendReviewComments: true, reviewThreads: settings })).toEqual({ ok: true, patch: { sendReviewComments: true, reviewThreads: settings } });
  expect(parseNodePatch("pr", "pr", { reviewThreads: null })).toEqual({ ok: true, patch: { reviewThreads: null } });
  // A bot's next review is waited for as long as reviewTimeoutMinutes.
  const bots = parseNodePatch("pr", "pr", { reviewThreads: { reply: true, botWaitMinutes: 30 } });
  expect(bots).toMatchObject({ ok: false, message: expect.stringContaining("botWaitMinutes") });
});

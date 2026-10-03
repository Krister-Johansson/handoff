import { expect, test } from "vitest";
import { CATALOG } from "../lib/assistant/catalog";
import { appView } from "./mcp-apps";

test("each catalog tool's view is one the assistant panel can draw, so the dashboard shows it as /api/mcp's clients do", () => {
  const linked = CATALOG.filter((t) => t.view).map((t) => [t.name, t.view!] as const);
  expect(Object.fromEntries(linked)).toEqual({
    get_run: "ui://handoff/run-card.html",
    list_attention: "ui://handoff/needs-you.html",
    list_inbox: "ui://handoff/needs-you.html",
    answer_question: "ui://handoff/question-card.html",
    answer_permission: "ui://handoff/permission-card.html",
    list_plan: "ui://handoff/plan-list.html",
  });
  for (const [name, uri] of linked) {
    expect(appView(uri), name).toMatchObject({ uri, html: expect.stringContaining(`data-view="${uri.slice("ui://handoff/".length, -".html".length)}"`), prefersBorder: false });
  }
});

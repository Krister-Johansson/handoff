import { afterEach, expect, test } from "vitest";
import { runUiTool } from "./run-ui-tool";

afterEach(() => {
  document.body.innerHTML = "";
});

test("the page's name comes from the heading's title, without a count beside it", async () => {
  document.body.innerHTML = `<main><h1><span data-page-title>Inbox</span><span>3</span></h1></main>`;
  const where = await runUiTool({ name: "where_am_i", args: {} }, () => {});
  expect(JSON.parse(where.text)).toMatchObject({ heading: "Inbox" });
});

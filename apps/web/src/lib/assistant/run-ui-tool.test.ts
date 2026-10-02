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

test("a navigation that redirects is done when the new page shows, and reports where it ended", async () => {
  window.history.replaceState({}, "", "/projects");
  document.body.innerHTML = `<main><h1>Projects</h1></main>`;
  const push = (href: string) => {
    // The server sends /runs/<id> on to the run's page under its project.
    setTimeout(() => {
      window.history.pushState({}, "", href.replace("/runs/", "/projects/p1/runs/"));
      document.body.innerHTML = `<main><h1>Add a CHANGELOG.md</h1></main>`;
    }, 30);
  };
  const started = Date.now();
  const outcome = await runUiTool({ name: "go_to_run", args: { run_id: "r1" } }, push, 2_000);
  expect(Date.now() - started).toBeLessThan(1_000);
  expect(outcome).toEqual({ text: "Opened Add a CHANGELOG.md (/projects/p1/runs/r1).", isError: false, note: "Opened Add a CHANGELOG.md" });
  expect(document.activeElement?.textContent).toBe("Add a CHANGELOG.md");
});

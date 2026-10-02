import { expect, test, vi } from "vitest";
import { runPageTool, type OpenPage } from "./run-page-tool";

const runPage = (handler: (args: { view: string }) => string): OpenPage => ({
  kind: "run",
  handlers: { page_show_view: (args) => handler(args as { view: string }) },
  describe: () => ({ view: "steps" }),
});

test("a bound tool runs with validated arguments and returns its text", async () => {
  const handler = vi.fn((args: { view: string }) => `Showing the ${args.view} view.`);
  const outcome = await runPageTool(runPage(handler), { name: "page_show_view", args: { view: "graph" } });
  expect(outcome).toEqual({ text: "Showing the graph view.", isError: false });
  expect(handler).toHaveBeenCalledWith({ view: "graph" });
});

test("invalid arguments are refused with the schema's messages and the handler does not run", async () => {
  const handler = vi.fn(() => "Showing it.");
  const outcome = await runPageTool(runPage(handler), { name: "page_show_view", args: { view: "map" } });
  expect(outcome.isError).toBe(true);
  expect(outcome.text).toMatch(/^The arguments for page_show_view are not valid: /);
  expect(outcome.text).toContain('expected one of "steps"|"graph"|"events"');
  expect(handler).not.toHaveBeenCalled();
});

test("a handler that refuses answers with its reason as an error", async () => {
  const page: OpenPage = {
    kind: "run",
    handlers: {
      page_open_step: () => {
        throw new Error("There is no step deploy. The steps are plan, code and review.");
      },
    },
    describe: () => ({}),
  };
  expect(await runPageTool(page, { name: "page_open_step", args: { step: "deploy" } })).toEqual({
    text: "There is no step deploy. The steps are plan, code and review.",
    isError: true,
  });
});

test("a tool of a page that is no longer open answers that the page changed and names the current path", async () => {
  window.history.replaceState({}, "", "/inbox?project=p1");
  expect(await runPageTool(undefined, { name: "page_show_view", args: { view: "graph" } })).toEqual({
    text: "The page changed: the person is now on /inbox?project=p1 (a page without tools). page_show_view is not available here. Call where_am_i.",
    isError: true,
  });

  const inbox: OpenPage = { kind: "inbox", handlers: { page_show_item: () => "Shown." }, describe: () => ({}) };
  expect(await runPageTool(inbox, { name: "page_show_view", args: { view: "graph" } })).toEqual({
    text: "The page changed: the person is now on /inbox?project=p1 (inbox). page_show_view is not available here. Call where_am_i.",
    isError: true,
  });

  // A tool of the page's kind that the page left unbound, such as a submit on an answered review.
  const answered: OpenPage = { kind: "run", handlers: { page_show_view: undefined }, describe: () => ({}) };
  expect(await runPageTool(answered, { name: "page_show_view", args: { view: "graph" } })).toMatchObject({ isError: true, text: expect.stringMatching(/^The page changed/) });
});

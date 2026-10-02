/**
 * A compile test: pnpm typecheck checks this file (test files are excluded from it) and nothing runs it.
 * A page passes only its kind, binds every handler and destructures their arguments; each argument
 * must still be its tool's input. If TypeScript infers the kind from the handlers object as well, the
 * arguments become implicit any and this file stops compiling.
 */
import { expectTypeOf } from "vitest";
import { usePageTools } from "./use-page-tools";

export function useTryPageWithEveryHandlerBound() {
  usePageTools(
    "try",
    {
      page_mark_criterion: ({ index, criterion, works, note }) => {
        expectTypeOf(index).toEqualTypeOf<number | undefined>();
        expectTypeOf(criterion).toEqualTypeOf<string | undefined>();
        expectTypeOf(works).toEqualTypeOf<boolean | null>();
        expectTypeOf(note).toEqualTypeOf<string | undefined>();
        return "marked";
      },
      page_go_to_criterion: ({ index, direction }) => {
        expectTypeOf(index).toEqualTypeOf<number | undefined>();
        expectTypeOf(direction).toEqualTypeOf<"next" | "previous" | undefined>();
        return "moved";
      },
      page_set_note: ({ note }) => note,
      page_submit: async ({ option }) => {
        expectTypeOf(option).toEqualTypeOf<"approve" | "changes">();
        return "sent";
      },
      page_restart_app: async () => "restarted",
      page_expand_criteria: ({ all }) => (all ? "expanded" : "collapsed"),
    },
    () => ({}),
  );
}

export function useTryPageWithAnotherPagesTool() {
  usePageTools(
    "try",
    {
      page_mark_criterion: undefined,
      page_go_to_criterion: undefined,
      page_set_note: undefined,
      page_submit: undefined,
      page_restart_app: undefined,
      page_expand_criteria: undefined,
      // @ts-expect-error A handler for a name the kind does not have is refused.
      page_show_view: () => "graph",
    },
    () => ({}),
  );
}

export function useRunPageWithEveryHandlerBound() {
  usePageTools(
    "run",
    {
      page_show_view: ({ view }) => {
        expectTypeOf(view).toEqualTypeOf<"steps" | "graph" | "events">();
        return view;
      },
      page_open_step: ({ step, attempt }) => `${step} ${attempt ?? "latest"}`,
      page_close_step: () => "closed",
      page_pop_out: ({ open }) => (open ? "out" : "in"),
      page_filter_events: ({ node, cli }) => {
        expectTypeOf(node).toEqualTypeOf<string | null | undefined>();
        return `${node ?? "every node"} ${cli ?? false}`;
      },
    },
    () => ({}),
  );
}

import { boolean, index, integer, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, tstz, updatedAt } from "./columns.ts";
import { questions } from "./questions.ts";
import { runs } from "./runs.ts";

/** Where a review item comes from: an inline thread, a review summary, a note or a pre-merge check in a review bot's summary comment. */
export const reviewItemKind = pgEnum("review_item_kind", ["thread", "review_body", "summary_note", "pre_merge_check"]);

/** The coder's answer to a review item, after it checked the item's claim. */
export const reviewItemVerdict = pgEnum("review_item_verdict", ["fixed", "declined", "unclear", "duplicate", "settled"]);

/** Where a review item stands, from found to resolved or handed to a person. */
export const reviewItemState = pgEnum("review_item_state", ["open", "answered", "awaiting_review", "resolved", "disputed", "reraised", "left", "gone"]);

/**
 * A finding an external reviewer left on a run's pull request, which the coder answers by its handle
 * (`R1` is handle 1). `key` names it on GitHub: `thread:<node id>`, `review:<id>`, `note:<hash>` or
 * `check:<name>`. The PR node is the only writer. The reply columns record which answer was posted for
 * which head commit, so a restarted step never posts it twice.
 */
export const reviewItems = pgTable(
  "review_items",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    handle: integer("handle").notNull(),
    key: text("key").notNull(),
    kind: reviewItemKind("kind").notNull(),
    githubId: text("github_id"),
    reviewer: text("reviewer").notNull(),
    reviewerBot: boolean("reviewer_bot").notNull().default(false),
    path: text("path"),
    line: integer("line"),
    body: text("body").notNull(),
    url: text("url"),
    /** The round of the PR node that sent the item to the coder, from 1. */
    round: integer("round").notNull(),
    verdict: reviewItemVerdict("verdict"),
    evidence: text("evidence"),
    fixCommit: text("fix_commit"),
    /** With a duplicate verdict: the handle of the item this one repeats. */
    duplicateOf: integer("duplicate_of"),
    /** When re-raised: the handle of the item for the reviewer's new thread on the same lines, which this one follows. */
    reraisedAs: integer("reraised_as"),
    /**
     * How often the item went back to the coder after an answer: the reviewer replied, a person sent it back,
     * or the next summary still listed a fixed summary item, which goes back once and then to a person.
     */
    returns: integer("returns").notNull().default(0),
    replyCommentId: text("reply_comment_id"),
    replyUrl: text("reply_url"),
    replyHeadSha: text("reply_head_sha"),
    repliedAt: tstz("replied_at"),
    state: reviewItemState("state").notNull().default("open"),
    stateReason: text("state_reason"),
    /** Who resolved it: handoff, the reviewer, a person's login, summary_dropped, or next_review for a review summary the next review left out. */
    resolvedBy: text("resolved_by"),
    resolvedAt: tstz("resolved_at"),
    questionId: uuid("question_id").references(() => questions.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("review_items_run_handle_unique").on(t.runId, t.handle),
    unique("review_items_run_key_unique").on(t.runId, t.key),
    index("review_items_run_state_idx").on(t.runId, t.state),
  ],
);

export type ReviewItemRow = typeof reviewItems.$inferSelect;

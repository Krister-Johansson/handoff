# 7. Notifications are their own entity

Date: 2026-10-02. Status: accepted.

## Decision

A notification is a row in the `notifications` table: a tone (`neutral`, `success`, `attention` or `danger`), a title, a body and an optional link into the dashboard. It has no reference to a question, a permission request or a node execution. Whoever has something to tell a person writes the row through `createNotification`, with the text and the link it wants shown, and the feed shows the row as it is.

A question and its notification are two entities. A human gate that stores a question creates the notification in the same transaction. Answering the question changes the question and leaves the notification alone.

A notification is read or unread, by the single watermark in `notification_reads`. It has no done state. What still waits for a person is the inbox, which reads questions, permission requests and runs directly.

The seven notify kinds (`started`, `finished`, `failed`, `input`, `permission`, `ready`, `merged`) remain a node's settings in the graph: they decide whether a node sends a notification. The sender maps the kind to a tone.

This replaces the `notify` event type. ADR 0002 still holds for the run's event log; notifications are no longer part of it.

## Consequences

- The feed reads one table. A new sender needs no change in the feed, the bell or the notifications page.
- The engine writes dashboard paths, so the path builders for a run, a review and a Try it page live in `packages/core`.
- A notification written in the transaction that ends a run fails that transaction if the table is missing. Migrate before the worker runs the new code.
- The bell no longer marks a notification done when its question is answered. A handled question keeps its notification in the feed's history.
- The four tones give four icons. A question and a permission request look alike in the bell and differ by their titles.
- `listAttention` and the Claude Code connector still list current state from questions and runs. They are a second channel for the same news and can move onto this table later.
- Actions on a notification can be added as one nullable column without changing the rest.

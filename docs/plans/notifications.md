# Notifications as their own entity

## Context

A notification today is a `notify` row in the `events` table. The feed (`listNotifications` in `apps/web/src/server/notifications.ts`) joins `questions`, `permission_requests`, `node_executions` and `runs` on every read to work out where each notification links and whether its action is done. A notification therefore cannot exist without the question or run it came from, and the feed knows about every kind of sender.

The target: a question and a notification are separate entities. When a gate creates a question it also creates a notification. A notification is a title, a description and an optional link, with room for actions later. The feed reads one table and adds nothing.

Decisions made on 2026-10-02:

1. The done state goes away. A notification is read or unread. What still waits for a person is the inbox's job, and the inbox already reads questions directly.
2. A notification carries a tone with four values (`neutral`, `success`, `attention`, `danger`) for icon, colour, toast style and speech. The seven kinds (`started`, `finished`, `failed`, `input`, `permission`, `ready`, `merged`) stay only as the node's notify settings in the graph.
3. The new table starts empty, and the migration deletes the existing `notify` rows from `events`.

## The entity

New table `notifications` in `packages/db/src/schema/notifications.ts`, following the conventions in `packages/db/src/schema/columns.ts`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, `id()` | The bell's seen set and the speech claim use it |
| `project_id` | uuid, nullable, references `projects.id` | For leaving out the demo project and for project deletion. Nullable so a later sender outside a project can notify |
| `run_id` | uuid, nullable, references `runs.id` | For cleanup with the run's project |
| `tone` | pgEnum `notification_tone` | `neutral`, `success`, `attention`, `danger` |
| `title` | text, not null | Written by the sender, shown as it is |
| `body` | text, not null | Written by the sender, shown as it is |
| `href` | text, nullable | A dashboard path. A notification without one is not a link |
| `created_at` | `createdAt()` | Index `notifications_created_idx` |

No column refers to a question, a permission request or a node execution. The read state stays the single watermark row in `notification_reads`: unread means `created_at` is after `read_until`.

Actions are not part of this change. When they come, they fit as one nullable `actions` jsonb column holding `{ label, href }` items, and nothing else in this design has to move.

## The service

One write function, `createNotification(db: DbExecutor, n)` in a new `packages/db/src/ops/notifications.ts`, exported from `packages/db/src/index.ts`. It takes `{ tone, title, body, href?, projectId?, runId? }` and inserts the row. It accepts a transaction, so a sender can commit the notification together with what it is about.

The read side stays in `apps/web/src/server/notifications.ts` and shrinks to: select from `notifications`, left join `projects` to leave out `is_demo`, compare `created_at` with the watermark, filter by `unread` or by tone, page with `before`. `markNotificationsRead` is unchanged.

## Senders

Each sender keeps writing its own title and body (the wording from #364 stays) and now also writes the link and picks the tone. A small engine helper, `notifyFrom(db, node, kind, run, { title, body, href })` in `packages/engine/src/notify.ts`, checks the node's setting with the existing `notifies(node, kind)`, maps the kind to a tone with a new `toneOf(kind)` in `packages/core/src/graph/notify.ts`, and calls `createNotification`. An executor reaches it through `ctx.notify(kind, { title, body, href })` on its `ExecutorContext`, which the worker implements with `notifyFrom`; the human gate calls `notifyFrom` itself, with the transaction that stores its question.

| Sender | File | Tone | Link | Written in |
|---|---|---|---|---|
| Run started | `packages/engine/src/scheduler/worker.ts` | neutral | run page | The claim transaction |
| Run failed | `packages/engine/src/scheduler/complete.ts` (`finishRouting`) | danger | run page | The transaction that ends the run |
| Run finished | same | success | run page | The transaction that ends the run |
| Gate asks, review or Try it | `packages/engine/src/executors/human-gate.ts` | attention | run, review or Try it page | One transaction with the question insert |
| Permission request | `packages/engine/src/executors/cli-node.ts` via `permissions/broker.ts` | attention | run page | `ctx.notify`, right after the request row; `onRequest` is awaited |
| PR ready to merge | `packages/engine/src/executors/github.ts` | attention | run page | `ctx.notify`, guarded by the existing `emittedBefore(merge.ready)` |
| PR merged | same | success | run page | `ctx.notify`, before the node completes |

`toneOf`: `started` is neutral; `finished` and `merged` are success; `input`, `permission` and `ready` are attention; `failed` is danger.

The gate change closes a gap that exists today: the question is inserted outside the event buffer, so a worker that dies between the insert and the 100 ms event flush leaves a question with no notification. With both in one transaction, and the notification created only when the insert returned a new row, a question always has exactly one notification.

The engine needs the dashboard paths to write links. `runPath`, `reviewPath` and `tryPath` move from `apps/web/src/lib/paths.ts` to `packages/core/src/paths.ts`; the web file re-exports them so its many importers do not change.

The `notify` event type disappears: no `ctx.emit("notify", ...)`, and the `Notification` payload type in core is removed. `human.asked`, `permission.requested`, `merge.ready` and the run events stay as they are in the run's event log.

## Web and tools

`apps/web/src/lib/notifications.ts`: `NotificationItem` becomes `{ id, tone, title, body, href, createdAt, unread }`. `NotificationFilter` becomes `"unread"` or a tone.

- `components/notifications/notification-list.tsx`: `KindTile` becomes a tone tile with four icons; `DoneTag` and the done styling go. A row without `href` renders as text, not a link.
- `components/notifications/notification-feed.tsx` and `filters.ts`: filters are All, Unread, and one per tone except neutral. The attention filter no longer hides handled items, so its label changes from "Needs you" to "Asked you"; the notifications page already points to the inbox for what still waits.
- `components/notification-bell.tsx`: toast style by tone (success, error 10 s, warning 10 s, info). Neutral gets no desktop notification, ping or speech, which is what `started` gets today.
- `lib/notify.ts`: speech rules by tone. Attention and danger are spoken; success only with `speakFinished`; neutral never.
- `server/agent-mcp.ts` `list_notifications`: items are `{ tone, title, body, at, unread, url }`. The filter enums in `lib/assistant/catalog.ts` (two places) and `lib/assistant/ui-tools.ts` follow.
- The inspector's per-node notify switches (`components/graph-editor/inspector.tsx`) are unchanged.

## Migrations and cleanup

1. `pnpm db:generate` for the enum and the table. Review the SQL and commit it.
2. A second, custom migration (`drizzle-kit generate --custom`) with `delete from events where type = 'notify'`. It is separate so its test can run the file on its own, like `packages/db/src/notify-backfill.integration.test.ts` does.
3. Both `deleteProject` functions (`packages/db/src/ops/projects.ts` and `apps/web/src/server/project-admin.ts`) delete the project's notifications before its runs.

## Out of scope

- Actions on a notification.
- Reading or dismissing one notification at a time; the watermark stays.
- `listAttention` and the Claude Code connector (`packages/connector/src/bridge.ts`). They list current state from questions and runs, not notifications, and keep doing so. Moving the connector onto the notifications table is a possible follow-up.
- A helper agent that writes notification text.

## Order of work (test first at each step)

1. Docs: this plan as `docs/plans/notifications.md`, ADR `docs/adr/0007-notifications-are-their-own-entity.md`, add Notification and Question to `GLOSSARY.md`, correct the `notify` event mention in `docs/plans/voice.md`. Open the GitHub issue; one branch and one PR.
2. `packages/db`: integration tests for `createNotification` and for both `deleteProject` paths, then the schema, the op and the generated migration. A test for the custom migration: seed `notify` and other events, run the file, only the `notify` rows are gone.
3. `packages/core`: tests for `toneOf` and the moved path builders, then the code. Remove the `Notification` payload type.
4. `packages/engine`: change the existing notify tests (`notify.integration.test.ts`, `executors/human-gate.integration.test.ts`, `try-it.integration.test.ts`, `merge-queue.integration.test.ts`, `permissions/permissions.integration.test.ts`) to assert rows in `notifications` with title, body, tone and href, and no `notify` events. Add: a gate run twice for the same execution creates one question and one notification. Then `notifyFrom` and the seven senders.
5. `apps/web` server: rewrite `notifications.integration.test.ts` for the table (newest first, unread by watermark, tone filters, demo left out, paging), add a `list_notifications` test to `agent-mcp.integration.test.ts`, then the reader and the MCP tool.
6. `apps/web` client: update `notification-bell.test.tsx`, `notification-list.test.tsx`, `notification-feed.test.tsx`, `lib/notify.test.ts`, `voice-provider.test.tsx`, `catalog.test.ts`, `ui-tools.test.ts`, then the components. Run `pnpm doctor:react`.

The senders and the reader switch in the same PR, because a reader on the table sees nothing until the senders write to it.

## Verification

- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm doctor:react` in the worktree (Postgres is already up; no `db:up` from a worktree).
- After merge, in the main checkout: stop the worker, `git pull`, `pnpm db:migrate`, start the worker. The order matters: the new worker writes a notification inside the transaction that ends a run, so the table has to exist before it runs.
- Start a run on a real project with a human gate. Check that the bell toasts the gate's title and summary, that Open leads to the review, Try it or run page, and that the row is in the table:
  `docker exec handoff-postgres-1 psql -U handoff -d handoff -c "select tone, title, body, href from notifications order by created_at desc limit 5"`
- Answer the question and confirm the notification stays as it was, with no Done tag, and that the inbox no longer lists the question.
- Confirm `select count(*) from events where type = 'notify'` is 0.

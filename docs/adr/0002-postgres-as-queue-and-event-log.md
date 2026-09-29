# 2. Postgres is the queue and the event log

Date: 2026-09-29. Status: accepted.

## Decision

`node_executions` is the work queue, claimed with `FOR UPDATE SKIP LOCKED` under a transaction-scoped advisory lock so per-executor-kind concurrency caps are exact across workers. Leases live in columns, not in held transactions. `events` is the append-only log, with a per-run gap-free `seq` allocated from `runs.next_event_seq` under the run row lock, so SSE cursors never skip. The dashboard tails events by polling; LISTEN/NOTIFY is a later latency optimisation.

## Consequences

One dependency to operate. The worker and the dashboard share nothing but the database. A crashed worker's executions are reclaimed by lease expiry.

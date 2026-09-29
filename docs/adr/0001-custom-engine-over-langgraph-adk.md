# 1. Custom engine instead of LangGraph.js or Google ADK

Date: 2026-09-29. Status: accepted.

## Context

handoff needs a durable graph runtime: runs pause for minutes or hours on webhooks and human answers, survive worker restarts, and contain nodes with side effects (commits, pushes, PR creation).

## Decision

Write a small scheduler over Postgres tables instead of adopting a framework.

- Google ADK for TypeScript added graph workflows in 2.0.0, but `Workflow` is still marked experimental in 2.1.0 and cross-process resume of a paused workflow is documented only for Python and Kotlin.
- LangGraph.js resumes an interrupted node by re-running it from its beginning, which would replay commits and PR creation before the pause.

## Consequences

The engine owns claiming, leases, waiting and routing. A node that waits yields an explicit `waiting` status and is resumed by a wake, never by replay. The engine code stays small enough to test directly.

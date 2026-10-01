import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactSecrets } from "@handoff/core";
import { and, eq, inArray, permissionRequests, type Db } from "@handoff/db";

/** The MCP tool Claude Code asks for permission through: the `approve` tool of handoff's permission server. */
export const PERMISSION_TOOL = "mcp__handoff__approve";

/** The permission server Claude Code starts over stdio, one per step. */
export const PERMISSION_SERVER = fileURLToPath(new URL("./permission-server.mjs", import.meta.url));

/** How long a request waits for a person before the server denies it and the step goes on. */
export const PERMISSION_TIMEOUT_MS = 30 * 60_000;

/** The MCP server entry for a step's permission folder. */
export const permissionServer = (dir: string, timeoutMs = PERMISSION_TIMEOUT_MS) => ({ command: process.execPath, args: [PERMISSION_SERVER, dir, String(timeoutMs)] });

export type PermissionWatch = {
  /** Whether a request still waits for a person: the step is not idle then, only waiting. */
  waiting(): boolean;
  /** Stops watching; requests nobody answered expire. */
  stop(): Promise<void>;
};

type Request = { id: string; toolName: string; input: Record<string, unknown> };

/**
 * Watches a step's permission folder while Claude Code runs. Each request the permission server writes
 * is recorded, and `onRequest` tells the person. Once they answer, the answer is written back for the
 * server to hand to Claude Code.
 */
export function watchPermissions(
  db: Db,
  step: { runId: string; executionId: string; dir: string; onRequest: (request: Request) => void; intervalMs?: number },
): PermissionWatch {
  mkdirSync(step.dir, { recursive: true });
  const open = new Set<string>();
  const known = new Set<string>();
  let ticking: Promise<void> = Promise.resolve();

  const tick = async () => {
    for (const file of existsSync(step.dir) ? readdirSync(step.dir) : []) {
      if (!file.endsWith(".request.json")) continue;
      const id = file.slice(0, -".request.json".length);
      if (known.has(id)) continue;
      known.add(id);
      // What the person sees, and what is stored, never carries a token the agent put in a command.
      const raw = JSON.parse(readFileSync(join(step.dir, file), "utf8")) as Request;
      const request = { ...raw, input: JSON.parse(redactSecrets(JSON.stringify(raw.input ?? {}))) as Record<string, unknown> };
      await db
        .insert(permissionRequests)
        .values({ id, runId: step.runId, nodeExecutionId: step.executionId, toolName: request.toolName, input: request.input })
        .onConflictDoNothing();
      open.add(id);
      step.onRequest({ id, toolName: request.toolName, input: request.input });
    }
    if (open.size === 0) return;
    const answered = await db
      .select()
      .from(permissionRequests)
      .where(and(inArray(permissionRequests.id, [...open]), inArray(permissionRequests.status, ["allowed", "denied", "expired"])));
    for (const row of answered) {
      open.delete(row.id);
      if (row.status === "expired") continue;
      const answer = row.status === "allowed" ? { behavior: "allow" } : { behavior: "deny", ...(row.message ? { message: row.message } : {}) };
      writeFileSync(join(step.dir, `${row.id}.response.json`), JSON.stringify(answer));
    }
  };
  const timer = setInterval(() => {
    ticking = ticking.then(tick).catch(() => {});
  }, step.intervalMs ?? 200);

  return {
    waiting: () => open.size > 0,
    async stop() {
      clearInterval(timer);
      await ticking;
      await tick().catch(() => {});
      await db
        .update(permissionRequests)
        .set({ status: "expired", decidedAt: new Date() })
        .where(and(eq(permissionRequests.nodeExecutionId, step.executionId), eq(permissionRequests.status, "pending")));
    },
  };
}

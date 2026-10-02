import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { redactSecrets } from "@handoff/core";
import { and, eq, inArray, nodeExecutions, permissionRequests, resumeAfterPermission, waitOnPermission, type Caps, type Db } from "@handoff/db";

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
  step: {
    runId: string;
    executionId: string;
    dir: string;
    onRequest: (request: Request) => void | Promise<void>;
    intervalMs?: number;
    /** The executor caps a step must fit in again before its answer goes back. Without them, it goes back at once. */
    caps?: Partial<Caps>;
    /** The permission server's timeout: a request older than this was denied by the server itself. */
    timeoutMs?: number;
  },
): PermissionWatch {
  mkdirSync(step.dir, { recursive: true });
  const open = new Set<string>();
  const known = new Set<string>();
  const askedAt = new Map<string, number>();
  const timeoutMs = step.timeoutMs ?? PERMISSION_TIMEOUT_MS;
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
      askedAt.set(id, Date.now());
      // While a person decides, the step's process idles and another step may use its slot.
      await waitOnPermission(db, step.executionId);
      await step.onRequest({ id, toolName: request.toolName, input: request.input });
    }
    if (open.size === 0) return;
    // The permission server denies a request nobody answered in time, and Claude Code goes on without the slot check.
    const late = [...open].filter((id) => Date.now() - (askedAt.get(id) ?? Date.now()) > timeoutMs);
    if (late.length) {
      await db
        .update(permissionRequests)
        .set({ status: "expired", decidedAt: new Date() })
        .where(and(inArray(permissionRequests.id, late), eq(permissionRequests.status, "pending")));
    }
    const answered = await db
      .select()
      .from(permissionRequests)
      .where(and(inArray(permissionRequests.id, [...open]), inArray(permissionRequests.status, ["allowed", "denied", "expired"])));
    if (answered.length === 0) return;
    // The answer goes back once the step has its slot again; until then it is asked for on every tick.
    const decided = answered.filter((row) => row.status !== "expired");
    if (decided.length && !(await resumeAfterPermission(db, step.executionId, step.caps ?? {}))) return;
    for (const row of answered) {
      open.delete(row.id);
      if (row.status === "expired") continue;
      const answer = row.status === "allowed" ? { behavior: "allow" } : { behavior: "deny", ...(row.message ? { message: row.message } : {}) };
      writeFileSync(join(step.dir, `${row.id}.response.json`), JSON.stringify(answer));
    }
    // Another request still waits for a person, or the last one expired: the slot follows what the process does.
    if (open.size > 0) await waitOnPermission(db, step.executionId);
    else if (decided.length === 0) await db.update(nodeExecutions).set({ waitingOn: null }).where(eq(nodeExecutions.id, step.executionId));
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
      await db.update(nodeExecutions).set({ waitingOn: null }).where(eq(nodeExecutions.id, step.executionId));
    },
  };
}

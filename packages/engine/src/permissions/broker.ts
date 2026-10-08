import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allowedBy, PERMISSION_TIMEOUT_MINUTES, redactSecrets } from "@handoff/core";
import { and, eq, inArray, isNotNull, isNull, ne, nodeExecutions, or, permissionRequests, resumeAfterPermission, waitOnPermission, type Caps, type Db } from "@handoff/db";

/** The MCP tool Claude Code asks for permission through: the `approve` tool of handoff's permission server. */
export const PERMISSION_TOOL = "mcp__handoff__approve";

/** The permission server Claude Code starts over stdio, one per step. */
export const PERMISSION_SERVER = fileURLToPath(new URL("./permission-server.mjs", import.meta.url));

/**
 * How long a request waits for a person before the server denies it and the step goes on, unless the
 * project's permission timeout says otherwise: 10 minutes, the projects column's default.
 */
export const PERMISSION_TIMEOUT_MS = PERMISSION_TIMEOUT_MINUTES.default * 60_000;

/** The MCP server entry for a step's permission folder. */
export const permissionServer = (dir: string, timeoutMs = PERMISSION_TIMEOUT_MS) => ({ command: process.execPath, args: [PERMISSION_SERVER, dir, String(timeoutMs)] });

export type PermissionWatch = {
  /** Whether a request still waits for a person: the step is not idle then, only waiting. */
  waiting(): boolean;
  /** Stops watching; requests nobody answered expire. */
  stop(): Promise<void>;
};

type Request = { id: string; toolName: string; input: Record<string, unknown> };

/** Who allowed a request handoff answered without a person: a person's Always allow earlier in the run, or the node's own allow list. */
export type AutoAllowedBy = "always allow" | "node allow list";

/**
 * The rules a person chose Always allow for in this run, for one node: they cover the node's later calls
 * and later attempts in the run, which stays on the graph version it started with. A rule from the
 * node's own allow list that answered a request is not one of them.
 */
export async function runAllowRules(db: Db, runId: string, nodeKey: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ rule: permissionRequests.rule })
    .from(permissionRequests)
    .innerJoin(nodeExecutions, eq(nodeExecutions.id, permissionRequests.nodeExecutionId))
    .where(
      and(
        eq(permissionRequests.runId, runId),
        eq(nodeExecutions.nodeKey, nodeKey),
        eq(permissionRequests.status, "allowed"),
        isNotNull(permissionRequests.rule),
        or(isNull(permissionRequests.decidedBy), ne(permissionRequests.decidedBy, "node allow list")),
      ),
    );
  return rows.map((r) => r.rule!).sort();
}

/**
 * Watches a step's permission folder while Claude Code runs. Each request the permission server writes
 * is recorded, and `onRequest` tells the person. Once they answer, the answer is written back for the
 * server to hand to Claude Code. A request one of the run's Always allow rules for the node covers is
 * allowed at once, and so is one the node's own allow list covers in handoff's reading: Claude Code
 * asks about some commands its list covers, such as echo with a variable or a loop. `onAutoAllowed`
 * records both.
 */
export function watchPermissions(
  db: Db,
  step: {
    runId: string;
    executionId: string;
    dir: string;
    /** The node's --allowedTools list. */
    allowedTools?: string[];
    onRequest: (request: Request) => void | Promise<void>;
    onAutoAllowed?: (request: Request & { rule: string; decidedBy: AutoAllowedBy }) => void | Promise<void>;
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
  let nodeKey: string | undefined;
  const rulesOfRun = async () => {
    nodeKey ??= (await db.select({ nodeKey: nodeExecutions.nodeKey }).from(nodeExecutions).where(eq(nodeExecutions.id, step.executionId)))[0]?.nodeKey;
    return nodeKey ? runAllowRules(db, step.runId, nodeKey) : [];
  };

  const tick = async () => {
    for (const file of existsSync(step.dir) ? readdirSync(step.dir) : []) {
      if (!file.endsWith(".request.json")) continue;
      const id = file.slice(0, -".request.json".length);
      if (known.has(id)) continue;
      known.add(id);
      // What the person sees, and what is stored, never carries a token the agent put in a command.
      const raw = JSON.parse(readFileSync(join(step.dir, file), "utf8")) as Request;
      const request = { ...raw, input: JSON.parse(redactSecrets(JSON.stringify(raw.input ?? {}))) as Record<string, unknown> };
      // Matched against what the agent sent, not the redacted copy, which is what the CLI runs.
      const byRun = allowedBy(await rulesOfRun(), raw.toolName, raw.input ?? {});
      const byNode = byRun ? undefined : allowedBy(step.allowedTools ?? [], raw.toolName, raw.input ?? {});
      const rule = byRun ?? byNode;
      if (rule) {
        const decidedBy: AutoAllowedBy = byRun ? "always allow" : "node allow list";
        await db
          .insert(permissionRequests)
          .values({ id, runId: step.runId, nodeExecutionId: step.executionId, toolName: request.toolName, input: request.input, status: "allowed", rule, decidedBy, decidedAt: new Date() })
          .onConflictDoNothing();
        writeFileSync(join(step.dir, `${id}.response.json`), JSON.stringify({ behavior: "allow" }));
        await step.onAutoAllowed?.({ id, toolName: request.toolName, input: request.input, rule, decidedBy });
        continue;
      }
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

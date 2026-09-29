import { appendEvents, eq, inArray, nodeExecutions, sql, wakeByKey, webhookDeliveries, type Db } from "@handoff/db";
import { correlationKeys, verifyGitHubSignature } from "@handoff/github";

const json = (body: unknown, status: number) => Response.json(body, { status });

/**
 * Verifies, records and correlates one GitHub delivery, then wakes matching waiting executions.
 * Decisions stay in the engine: the woken PR node re-reads live PR state from the API.
 */
export async function handleGitHubWebhook(db: Db, request: Request, secret: string): Promise<Response> {
  const raw = await request.text();
  if (!verifyGitHubSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
    return json({ error: "invalid signature" }, 401);
  }
  const event = request.headers.get("x-github-event") ?? "unknown";
  const deliveryId = request.headers.get("x-github-delivery") ?? crypto.randomUUID();
  if (event === "ping") return json({ ok: true }, 200);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const action = typeof payload.action === "string" ? payload.action : null;
  const repository = payload.repository as { id?: unknown } | undefined;
  const installation = payload.installation as { id?: unknown } | undefined;
  const keys = correlationKeys(event, payload);

  const [stored] = await db
    .insert(webhookDeliveries)
    .values({
      deliveryId,
      eventName: event,
      action,
      installationId: typeof installation?.id === "number" ? installation.id : null,
      repoId: typeof repository?.id === "number" ? repository.id : null,
      correlationKeys: keys,
      payload,
    })
    .onConflictDoNothing({ target: webhookDeliveries.deliveryId })
    .returning({ id: webhookDeliveries.id });
  if (!stored) return json({ duplicate: true }, 200);

  const results = await Promise.all(keys.map((key) => wakeByKey(db, key, { reason: "webhook", payload: { deliveryId, event, action } })));
  const touched = results.flatMap((r) => [...r.woken, ...r.flagged]);
  await db
    .update(webhookDeliveries)
    .set({ wokeExecutionIds: touched, processedAt: sql`now()` })
    .where(eq(webhookDeliveries.id, stored.id));

  if (touched.length > 0) {
    const rows = await db
      .select({ id: nodeExecutions.id, runId: nodeExecutions.runId })
      .from(nodeExecutions)
      .where(inArray(nodeExecutions.id, touched));
    await Promise.all(
      [...new Set(rows.map((r) => r.runId))].map((runId) =>
        db.transaction((tx) =>
          appendEvents(tx, runId, [
            {
              type: "github.webhook",
              payload: { event, action, deliveryId, keys },
              nodeExecutionId: rows.find((r) => r.runId === runId)?.id ?? null,
            },
          ]),
        ),
      ),
    );
  }
  return json({ keys, woke: touched.length }, 202);
}

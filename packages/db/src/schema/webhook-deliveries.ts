import { bigint, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tstz } from "./columns.ts";

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    deliveryId: text("delivery_id").notNull().unique(),
    eventName: text("event_name").notNull(),
    action: text("action"),
    installationId: bigint("installation_id", { mode: "number" }),
    repoId: bigint("repo_id", { mode: "number" }),
    correlationKeys: text("correlation_keys").array().notNull().default(sql`'{}'::text[]`),
    payload: jsonb("payload").$type<unknown>().notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    processedAt: tstz("processed_at"),
    wokeExecutionIds: uuid("woke_execution_ids").array().notNull().default(sql`'{}'::uuid[]`),
  },
  (t) => [index("webhook_deliveries_repo_received_idx").on(t.repoId, t.receivedAt.desc())],
);

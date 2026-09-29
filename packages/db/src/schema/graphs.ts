import { index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./columns.ts";
import { projects } from "./projects.ts";

export const graphs = pgTable(
  "graphs",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    latestVersion: integer("latest_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique("graphs_project_name_unique").on(t.projectId, t.name)],
);

export const graphVersions = pgTable(
  "graph_versions",
  {
    id: id(),
    graphId: uuid("graph_id")
      .notNull()
      .references(() => graphs.id),
    version: integer("version").notNull(),
    // Typed as GraphDocument from @handoff/core once it exists (M1).
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("graph_versions_graph_version_unique").on(t.graphId, t.version),
    index("graph_versions_graph_idx").on(t.graphId),
  ],
);

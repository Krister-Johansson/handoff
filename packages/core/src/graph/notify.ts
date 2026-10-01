import { z } from "zod";
import type { NodeType } from "../schema/graph.ts";

/**
 * What a node can tell a person about: the run started (Start) or finished (Finish), the node failed,
 * a gate waits for an answer, a pull request is ready to merge, or it merged.
 */
export const NotifyKindSchema = z.enum(["started", "finished", "failed", "input", "ready", "merged"]);
export type NotifyKind = z.infer<typeof NotifyKindSchema>;

/** A node's notification settings, by kind. A kind left out uses its default. */
export const NotifySettingsSchema = z.partialRecord(NotifyKindSchema, z.boolean());
export type NotifySettings = z.infer<typeof NotifySettingsSchema>;

/** On by default: what needs a person, and how the run ended. Starts and merges stay quiet. */
const DEFAULT_ON: Record<NotifyKind, boolean> = { started: false, finished: true, failed: true, input: true, ready: true, merged: false };

/** What a node of this type can notify about, in the order the inspector lists them. */
export function notifyKindsOf(type: NodeType): NotifyKind[] {
  if (type === "start") return ["started"];
  if (type === "finish") return ["finished"];
  if (type === "human_gate") return ["input", "failed"];
  if (type === "merge") return ["ready", "merged", "failed"];
  return ["failed"];
}

/**
 * Whether a node notifies about `kind`: its own setting, or the default. A Finish node saved before
 * these settings kept its switch in `config.notify`, which still counts for `finished`.
 */
export function notifies(node: { notify?: NotifySettings | undefined; config?: Record<string, unknown> }, kind: NotifyKind): boolean {
  const earlier = kind === "finished" && typeof node.config?.notify === "boolean" ? node.config.notify : undefined;
  return node.notify?.[kind] ?? earlier ?? DEFAULT_ON[kind];
}

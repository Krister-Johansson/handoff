const AT_WORK = new Set(["running", "waiting", "pending"]);

/**
 * The edges that started the nodes still at work: for each node, its latest execution's edge, when
 * that execution is running, waiting or queued. They show how the run got where it is.
 */
export function triggeringEdges(executions: { nodeKey: string; status: string; via?: string | null | undefined }[]): Set<string> {
  const latest = new Map<string, { status: string; via?: string | null | undefined }>();
  for (const e of executions) latest.set(e.nodeKey, e);
  const edges = new Set<string>();
  for (const e of latest.values()) if (AT_WORK.has(e.status) && e.via) edges.add(e.via);
  return edges;
}

import { describePermission } from "@handoff/core";
import { ordinal, settingsText } from "./scheduler-text";

type EventLike = { type: string; payload: unknown };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function assistantSummary(payload: Record<string, unknown>): string {
  const content = obj(payload.message).content;
  if (!Array.isArray(content)) return "";
  for (const block of content) {
    const b = obj(block);
    if (b.type === "text" && typeof b.text === "string") return b.text.trim().split("\n")[0] ?? "";
    if (b.type === "tool_use" && typeof b.name === "string") {
      const input = obj(b.input);
      const target = input.file_path ?? input.path ?? input.command ?? input.pattern;
      return typeof target === "string" ? `${b.name} ${target}` : b.name;
    }
  }
  return "";
}

/** One line of human-readable detail per event type. */
export function summarizeEvent(event: EventLike): string {
  const p = obj(event.payload);
  if (event.type.startsWith("node.")) {
    const base = typeof p.nodeKey === "string" ? `${p.nodeKey}${typeof p.attempt === "number" ? `, attempt ${p.attempt}` : ""}` : "";
    const error = obj(p.error).message;
    return typeof error === "string" ? `${base}: ${error}` : base;
  }
  if (event.type === "permission.auto_allowed") {
    // Events from before the node's allow list answered requests carry no decidedBy: a person's Always allow covered them.
    const source = p.decidedBy === "node allow list" ? "in the node's allow list" : "chosen earlier in this run";
    return `Allowed by ${String(p.rule)}, ${source}: ${describePermission(String(p.toolName), obj(p.input)).summary}`;
  }
  if (event.type === "edge.taken") return `${String(p.from)} to ${String(p.to)}`;
  if (event.type === "edge.returned") return `${String(p.from)} ${String(p.message)}`;
  if (event.type === "edge.exhausted") return `${String(p.edgeKey)} after ${String(p.attempts)} attempts`;
  if (event.type === "contract.checked") return `${String(p.kind)}: ${p.passed ? "passed" : "failed"}${p.detail ? `, ${String(p.detail)}` : ""}`;
  if (event.type === "cli.assistant") return assistantSummary(p);
  if (event.type === "cli.system.init") return typeof p.model === "string" ? `model ${p.model}` : "";
  if (event.type.startsWith("cli.result")) {
    const turns = typeof p.num_turns === "number" ? `${p.num_turns} turns` : "";
    const cost = typeof p.total_cost_usd === "number" ? `$${p.total_cost_usd.toFixed(2)}` : "";
    return [turns, cost].filter(Boolean).join(", ");
  }
  if (event.type === "run.failed") return typeof p.nodeKey === "string" ? `at ${p.nodeKey}` : "";
  if (event.type === "run.cancelled") return typeof p.reason === "string" ? p.reason : "";
  // A gate the loop reached names itself and the person; resolve_loop names neither.
  if (event.type === "loop.resolved") {
    const decided = `${String(p.action)} for ${String(p.edgeKey)}`;
    return typeof p.gate === "string" ? `${String(p.by ?? "a person")} chose ${String(p.action)} at ${p.gate} for ${String(p.edgeKey)}` : decided;
  }
  if (event.type === "run.created" && typeof p.branchName === "string") return p.branchName;
  if (event.type === "run.scheduled" && typeof p.place === "number") return `Started by the scheduler, ${ordinal(p.place)} in order: ${settingsText(obj(p.settings))}`;
  if (event.type === "run.overlap_held" && Array.isArray(p.paths)) return `Waiting: shares ${p.paths.join(", ")} with run ${String(p.runId).slice(0, 8)}`;
  if (event.type === "approval.held" && typeof p.message === "string") return p.message;
  if (event.type === "run.issue_unlinked") return `#${String(p.issue)} unlinked by ${String(p.by)}${typeof p.pr === "number" ? `; PR #${p.pr} no longer closes it` : ""}`;
  if (event.type === "plan.status")return `#${String(p.issue)} to ${String(p.status)}`;
  if (event.type === "plan.skipped") return `#${String(p.issue)} not moved to ${String(p.status)}: ${SKIP_REASONS[String(p.reason)] ?? String(p.reason)}`;
  if (event.type === "issue.assigned") return `#${String(p.issue)} assigned to ${String(p.login)}`;
  if (event.type === "issue.assign.skipped") return `#${String(p.issue)} not assigned: ${assignSkipReason(String(p.reason))}`;
  return "";
}

/** Why assigning a run's issue was skipped, for the codes assignStarter records; other reasons are GitHub's own message. */
const ASSIGN_SKIP_REASONS: Record<string, string> = {
  "no-user": "a GitHub App has no user to assign",
  "not-assignable": "GitHub cannot assign the token's user in this repository",
};

/** Why assigning a run's issue was skipped, as a phrase. */
export const assignSkipReason = (reason: string) => ASSIGN_SKIP_REASONS[reason] ?? reason;

/** Why a status write on the plan was skipped, for the codes writePlanStatus records; other reasons are GitHub's own message. */
const SKIP_REASONS: Record<string, string> = {
  "not-in-project": "not in the plan's Project",
  "no-option": "the Project has no such Status option",
  "no-access": "no GITHUB_TOKEN with the project scope",
};

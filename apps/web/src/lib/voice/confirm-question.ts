import type { PendingRequest } from "@/lib/assistant/port";

type Asked = Pick<PendingRequest, "name" | "args" | "summary">;

const option = (args: unknown) => (args && typeof args === "object" && "option" in args ? args.option : undefined);
const decision = (args: unknown) => (args && typeof args === "object" && "decision" in args ? args.decision : undefined);

const REVIEW: Record<string, string> = {
  approve: "Approve the review?",
  changes: "Send the review back with changes?",
  fix: "Approve the review after the fixes?",
  split: "Split the task as proposed?",
};

/**
 * The question a confirmation card in the voice bubble asks, and the speaker reads before "Say yes or
 * no": the tools that ask first by what they will do, any other tool by its summary.
 */
export function confirmQuestion({ name, args, summary }: Asked): string {
  if (name === "page_submit") return option(args) === "approve" ? "Approve the try it?" : "Send the try it back to the coder?";
  if (name === "page_submit_review") {
    const asked = REVIEW[String(option(args))];
    if (asked) return asked;
  }
  if (name === "page_restart_app") return "Start the app again?";
  if (name === "answer_permission") return decision(args) === "allow" ? "Allow the permission request once?" : "Deny the permission request?";
  return `${summary.trim().replace(/[.!?:;,]+$/, "")}?`;
}

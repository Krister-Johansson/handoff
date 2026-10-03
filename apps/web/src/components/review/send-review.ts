import { unstable_rethrow } from "next/navigation";
import { answerReviewAction } from "@/app/inbox/actions";

/** "split" accepts the split a planner proposed: handoff opens the later parts' issues and the run builds the first. */
export type ReviewOption = "changes" | "approve" | "fix" | "split";

export type SentComment = {
  quote: string;
  body: string;
  path?: string;
  line?: number;
  endLine?: number;
  side?: "old" | "new";
};

/** Whether an error is Next's own: the redirect a server action ends with, after Next has started the navigation. */
export function isNextNavigation(error: unknown) {
  try {
    unstable_rethrow(error);
    return false;
  } catch {
    return true;
  }
}

const NOTHING_TO_FIX = "Add a comment or an overall comment first, so there is something to fix.";
const NOTHING_PICKED = "Pick Fix now on a finding, or add a comment or an overall comment, so there is something to fix.";

/** Whether an option sends the work back to be changed, with the Fix now findings and the comments. */
export const sendsBack = (option: ReviewOption | undefined) => option === "changes" || option === "fix";

/** `count` of a thing, with the thing's plural when the count is not 1. */
export const countOf = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Parts of a sentence joined as a list: "a", "a and b", "a, b and c". */
const listOf = (parts: string[]) => (parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

type Review = {
  questionId: string;
  runId: string;
  option: ReviewOption;
  note: string;
  comments: SentComment[];
  /**
   * The code reviewer's Fix now findings, by their place in the review from 0; undefined when the review
   * has no findings. Request changes and approve after fixes send them back.
   */
  findings?: number[] | undefined;
  /** Called as the review is sent, to drop the kept draft, and again if sending failed, to keep it. */
  onSending?: (() => void) | undefined;
  onFailed?: (() => void) | undefined;
};

/**
 * Sends a review, as the Send review button and page_submit_review both do. Request changes and
 * approve after fixes need a Fix now finding, a comment or an overall comment. Resolves to why the
 * review was not sent; once sent, the action redirects to the run page, which reaches the caller as
 * Next's redirect error.
 */
export async function sendReview({ questionId, runId, option, note, comments, findings, onSending, onFailed }: Review): Promise<string | undefined> {
  const picked = sendsBack(option) ? findings : undefined;
  if (sendsBack(option) && !note.trim() && comments.length === 0 && !picked?.length) return findings ? NOTHING_PICKED : NOTHING_TO_FIX;
  // A sent review redirects to the run, so the draft goes first and comes back if the send fails.
  onSending?.();
  const result = await answerReviewAction({ questionId, runId, option, note: note.trim(), comments, ...(picked ? { findings: picked } : {}) });
  if (result && "error" in result && result.error) {
    onFailed?.();
    return result.error;
  }
  return undefined;
}

/** What was sent, in words, for the page tool's answer. */
function sentText({ option, target, comments, note, findings }: Review & { target: string }) {
  const sent = sendsBack(option) && findings?.length ? [countOf(findings.length, "finding")] : [];
  const parts = listOf([...sent, ...(comments.length > 0 ? [countOf(comments.length, "comment")] : []), ...(note.trim() ? ["the overall comment"] : [])]);
  if (option === "approve") return `Approved${parts ? ` with ${parts}` : ""}. The run page opens.`;
  if (option === "changes") return `Requested changes from ${target} with ${parts}. The run page opens.`;
  if (option === "split") return "Split as proposed: handoff opened an issue for each later part, and the run builds the first. The run page opens.";
  return `Approved after fixes: sent ${parts} back to ${target}. The run page opens.`;
}

/**
 * page_submit_review on either review page: sends the review and answers with what was sent, or
 * throws why it was not. Next's redirect after a successful send counts as sent.
 */
export async function submitReviewTool(review: Review & { target: string }): Promise<string> {
  try {
    const error = await sendReview(review);
    if (error) throw new Error(error);
  } catch (error) {
    if (!isNextNavigation(error)) throw error;
  }
  return sentText(review);
}

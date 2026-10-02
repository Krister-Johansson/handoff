import { unstable_rethrow } from "next/navigation";
import { answerReviewAction } from "@/app/inbox/actions";

export type ReviewOption = "changes" | "approve" | "fix";

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

type Review = {
  questionId: string;
  runId: string;
  option: ReviewOption;
  note: string;
  comments: SentComment[];
  /** Called as the review is sent, to drop the kept draft, and again if sending failed, to keep it. */
  onSending?: (() => void) | undefined;
  onFailed?: (() => void) | undefined;
};

/**
 * Sends a review, as the Send review button and page_submit_review both do. Request changes and
 * approve after fixes need a comment or an overall comment. Resolves to why the review was not sent;
 * once sent, the action redirects to the run page, which reaches the caller as Next's redirect error.
 */
export async function sendReview({ questionId, runId, option, note, comments, onSending, onFailed }: Review): Promise<string | undefined> {
  if (option !== "approve" && !note.trim() && comments.length === 0) return NOTHING_TO_FIX;
  // A sent review redirects to the run, so the draft goes first and comes back if the send fails.
  onSending?.();
  const result = await answerReviewAction({ questionId, runId, option, note: note.trim(), comments });
  if (result && "error" in result && result.error) {
    onFailed?.();
    return result.error;
  }
  return undefined;
}

/** What was sent, in words, for the page tool's answer. */
function sentText(option: ReviewOption, target: string, comments: number, note: string) {
  const parts = [comments > 0 ? `${comments} ${comments === 1 ? "comment" : "comments"}` : undefined, note.trim() ? "the overall comment" : undefined].filter(Boolean).join(" and ");
  if (option === "approve") return `Approved${parts ? ` with ${parts}` : ""}. The run page opens.`;
  if (option === "changes") return `Requested changes from ${target} with ${parts}. The run page opens.`;
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
  return sentText(review.option, review.target, review.comments.length, review.note);
}

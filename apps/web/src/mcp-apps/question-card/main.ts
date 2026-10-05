import type { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/client";
import { say, statusLine } from "../shared/act";
import { startView, valueOf, type Outcome, type ViewHost } from "../shared/app";
import { cardActions, cardContext, cardTitle, inboxCard, openRun, type QuestionData } from "../shared/cards";
import { el, ICONS } from "../shared/dom";
import { questionOf, readInbox, reviewOf } from "../shared/inbox";

type Asked = { question_id?: unknown; answer?: unknown; option?: unknown; criteria?: unknown };
type State = { asked?: Asked; question?: QuestionData; outcome?: Outcome };

/** The answer in words: the option and the note, or a Try it gate's verdict as answer_question's approval card says it. */
function answerText(asked: Asked | undefined) {
  if (Array.isArray(asked?.criteria)) {
    const criteria = asked.criteria as { works?: unknown }[];
    const failing = criteria.filter((c) => !c.works).length;
    return failing ? `Try it: ${failing} of ${criteria.length} criteria do not work` : "Try it: every criterion works";
  }
  const option = typeof asked?.option === "string" ? asked.option : undefined;
  const answer = typeof asked?.answer === "string" ? asked.answer.trim() : "";
  return [option, answer && answer !== option ? answer : undefined].filter(Boolean).join(": ");
}

/**
 * answer_question's card: the question it answers, with the node that asked, while the Inbox still has it, the
 * answer, pending until the result comes back, then that it is answered or why it failed.
 */
function render(root: HTMLElement, state: State, host: ViewHost) {
  const { asked, question, outcome } = state;
  const title = question?.question ?? "Question";
  const status = statusLine();
  if (!outcome) say(status, "Sending the answer…", "pending");
  else if (outcome.ok) say(status, "Answered.");
  else say(status, outcome.error, "error");
  const url = (outcome?.ok ? (outcome.value as { url?: unknown } | null)?.url : undefined) ?? question?.url;
  const answer = answerText(asked);
  root.replaceChildren(
    inboxCard(
      ICONS.question,
      "active",
      title,
      cardContext(question?.review_url ? "Approval requested" : "A node asked a question", "active", question ?? {}, question?.node),
      cardTitle(title),
      answer && el("p", "answer", answer),
      status,
      cardActions(openRun(typeof url === "string" ? url : undefined, host)),
    ),
  );
}

/** Starts the question card in `root` as an MCP Apps view of answer_question. */
export function startQuestionCard(root: HTMLElement, transport?: Transport): Promise<App> {
  const state: State = {};
  return startView(
    "question card",
    {
      input: (args, host) => {
        state.asked = args as Asked;
        render(root, state, host);
        // The question leaves the Inbox once it is answered, so its text comes from there while the answer is pending.
        void readInbox(host).then((inbox) => {
          const id = state.asked?.question_id;
          const question = inbox?.questions.find((q) => q.id === id);
          const review = inbox?.reviews.find((q) => q.id === id);
          if (!question && !review) return;
          state.question = question ? questionOf(question) : reviewOf(review!);
          render(root, state, host);
        });
      },
      result: (result, host) => {
        state.outcome = valueOf(result, "answer_question");
        render(root, state, host);
      },
    },
    transport,
  );
}

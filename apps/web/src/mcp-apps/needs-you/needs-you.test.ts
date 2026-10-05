import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { deferred, errorResult, mountView, textResult, unmountViews } from "../testing";
import { startNeedsYou } from "./main";

const BASE = "http://localhost:3000";
const RUN = "7f3a2c1e-0000-4000-8000-000000000001";
const RUN_URL = `${BASE}/projects/p1/runs/${RUN}`;

/** list_inbox's answer with one item in each group. */
const inbox = {
  permissions: [{ id: "perm1", project: "sandbox", run: "Add a CHANGELOG", node: "coder", tool: "Bash", asks: "asks to run a command", detail: "Runs the unit tests\npnpm test", url: RUN_URL }],
  reviews: [{ id: "q-review", project: "sandbox", run: "Add a CHANGELOG", node: "plan-review", question: "Approve the plan?", url: `${RUN_URL}/review/q-review` }],
  questions: [
    { id: "q1", project: "sandbox", run: "Add a CHANGELOG", node: "gate", question: "Which database?", options: ["postgres", "sqlite"], url: RUN_URL },
    { id: "q2", project: "sandbox", run: "Add a CHANGELOG", node: "ask", question: "What should the release be called?", options: [], url: RUN_URL },
    { id: "q-try", project: "sandbox", run: "Add a CHANGELOG", node: "try", question: "Does it work?", options: ["approve", "changes"], url: `${RUN_URL}/try/q-try` },
  ],
  ready_to_merge: [{ run_id: RUN, project: "sandbox", run: "Fix the footer", pr: 88, url: RUN_URL }],
  failed_runs: [{ run_id: RUN, project: "sandbox", run: "Shaping tools", node: "coder", url: RUN_URL }],
  stuck_runs: [{ run_id: RUN, project: "sandbox", run: "Review loop", node: "reviewer", loop: "review-loop", attempts: 3, url: RUN_URL }],
  pull_requests: [{ run_id: RUN, project: "sandbox", run: "Docs", pr: 90, pr_url: "https://github.com/octo/sample/pull/90", ci: "success", url: RUN_URL }],
};

const empty = { permissions: [], reviews: [], questions: [], ready_to_merge: [], failed_runs: [], stuck_runs: [], pull_requests: [] };

afterEach(unmountViews);

const group = (name: RegExp) => within(screen.getByRole("region", { name }));

test("list_inbox shows what needs the person in the Inbox's groups, in its order, each with its count", async () => {
  await mountView(startNeedsYou, { input: {}, result: textResult(inbox) });
  const list = await screen.findByRole("region", { name: "Needs you" });
  expect(within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Permission requests1",
    "Reviews to open1",
    "Questions to answer3",
    "Ready to merge1",
    "Runs that stopped2",
    "Pull requests waiting for your review1",
  ]);
  expect(within(list).getByText("9 items")).toBeInTheDocument();
  // The permission card: the step, what it asks and the whole command.
  const permission = group(/^Permission requests/);
  expect(permission.getByRole("heading", { name: "coder asks to run a command" })).toBeInTheDocument();
  expect(permission.getByText(/pnpm test/)).toBeInTheDocument();
  expect(permission.getByText("The step waits for your answer. Its allow rules do not cover this call.")).toBeInTheDocument();
  // A review and a Try it gate are answered on their pages.
  expect(group(/^Reviews to open/).getByRole("link", { name: "Open the review" })).toHaveAttribute("href", `${RUN_URL}/review/q-review`);
  const questions = group(/^Questions to answer/);
  expect(questions.getByRole("link", { name: "Open Try it" })).toHaveAttribute("href", `${RUN_URL}/try/q-try`);
  expect(questions.getByRole("button", { name: "postgres" })).toBeInTheDocument();
  expect(questions.getByRole("button", { name: "Send answer" })).toBeInTheDocument();
  expect(group(/^Ready to merge/).getByText("First in the merge queue. It is brought up to date with main before it merges.")).toBeInTheDocument();
  const stopped = group(/^Runs that stopped/);
  expect(stopped.getByText("failed at coder")).toBeInTheDocument();
  expect(stopped.getByText("reviewer sent the work back 3 times, as often as review-loop allows.")).toBeInTheDocument();
  const pulls = group(/^Pull requests/);
  expect(pulls.getByText("CI passing")).toBeInTheDocument();
  expect(pulls.getByRole("link", { name: "Review on GitHub" })).toHaveAttribute("href", "https://github.com/octo/sample/pull/90");
  expect(within(list).getByRole("link", { name: "Open the Inbox" })).toHaveAttribute("href", `${BASE}/inbox`);
});

test("a pull request whose merge waits on unresolved review threads says how many and links to resolve them", async () => {
  const threads = { ...empty, pull_requests: [{ run_id: RUN, project: "sandbox", run: "Docs", pr: 91, pr_url: "https://github.com/octo/sample/pull/91", ci: null, unresolved_threads: 2, url: RUN_URL }] };
  await mountView(startNeedsYou, { input: {}, result: textResult(threads) });
  await screen.findByRole("region", { name: "Needs you" });
  const pulls = group(/^Pull requests/);
  expect(pulls.getByText("2 unresolved review threads. The merge goes on once they are resolved.")).toBeInTheDocument();
  expect(pulls.getByRole("link", { name: "Resolve on GitHub" })).toHaveAttribute("href", "https://github.com/octo/sample/pull/91");
});

test("Allow once asks answer_permission, shows it pending until the result comes back, then says it is allowed", async () => {
  const answer = deferred<ReturnType<typeof textResult>>();
  const { calls } = await mountView(startNeedsYou, { input: {}, result: textResult(inbox), tools: { answer_permission: () => answer.promise } });
  const card = within(await screen.findByRole("article", { name: "coder asks to run a command" }));
  fireEvent.click(card.getByRole("button", { name: "Allow once" }));
  await waitFor(() => expect(calls).toEqual([{ name: "answer_permission", arguments: { request_id: "perm1", decision: "allow" } }]));
  expect(card.getByRole("status")).toHaveTextContent("Allowing once…");
  expect(card.getByRole("button", { name: "Allow once" })).toBeDisabled();
  expect(card.getByRole("button", { name: "Deny" })).toBeDisabled();
  answer.resolve(textResult({ decision: "allowed", url: RUN_URL }));
  await waitFor(() => expect(card.getByRole("status")).toHaveTextContent("Allowed once."));
  expect(card.queryByRole("button", { name: "Allow once" })).not.toBeInTheDocument();
});

test("Deny sends the note with the denial", async () => {
  const { calls } = await mountView(startNeedsYou, { input: {}, result: textResult(inbox), tools: { answer_permission: () => textResult({ decision: "denied", url: RUN_URL }) } });
  const card = within(await screen.findByRole("article", { name: "coder asks to run a command" }));
  fireEvent.change(card.getByLabelText("Note for Claude (optional)"), { target: { value: "Run pnpm test:unit instead" } });
  fireEvent.click(card.getByRole("button", { name: "Deny" }));
  await waitFor(() => expect(card.getByRole("status")).toHaveTextContent("Denied."));
  expect(calls).toEqual([{ name: "answer_permission", arguments: { request_id: "perm1", decision: "deny", message: "Run pnpm test:unit instead" } }]);
});

test("a refused answer shows why and lets the person answer again", async () => {
  await mountView(startNeedsYou, { input: {}, result: textResult(inbox), tools: { answer_permission: () => errorResult("The person declined this tool call.") } });
  const card = within(await screen.findByRole("article", { name: "coder asks to run a command" }));
  fireEvent.click(card.getByRole("button", { name: "Allow once" }));
  await waitFor(() => expect(card.getByRole("alert")).toHaveTextContent("The person declined this tool call."));
  expect(card.getByRole("button", { name: "Allow once" })).toBeEnabled();
});

test("a host that fails the call shows its error too, as the host worded it", async () => {
  await mountView(startNeedsYou, {
    input: {},
    result: textResult(inbox),
    tools: {
      answer_permission: () => {
        throw new Error("Not approved");
      },
    },
  });
  const card = within(await screen.findByRole("article", { name: "coder asks to run a command" }));
  fireEvent.click(card.getByRole("button", { name: "Allow once" }));
  await waitFor(() => expect(card.getByRole("alert")).toHaveTextContent(/^Not approved$/));
});

test("an option answers the question with that option, and the details as the answer when given", async () => {
  const { calls } = await mountView(startNeedsYou, { input: {}, result: textResult(inbox), tools: { answer_question: () => textResult({ answered: true, run_id: RUN, url: RUN_URL }) } });
  const card = within(await screen.findByRole("article", { name: "Which database?" }));
  fireEvent.click(card.getByRole("button", { name: "postgres" }));
  await waitFor(() => expect(card.getByRole("status")).toHaveTextContent("Answered: postgres"));
  const other = within(screen.getByRole("article", { name: "What should the release be called?" }));
  fireEvent.click(other.getByRole("button", { name: "Send answer" }));
  expect(other.getByRole("alert")).toHaveTextContent("Pick an option or write an answer.");
  fireEvent.change(other.getByLabelText("Answer"), { target: { value: "Autumn" } });
  fireEvent.click(other.getByRole("button", { name: "Send answer" }));
  await waitFor(() => expect(other.getByRole("status")).toHaveTextContent("Answered: Autumn"));
  expect(calls).toEqual([
    { name: "answer_question", arguments: { question_id: "q1", option: "postgres", answer: "postgres" } },
    { name: "answer_question", arguments: { question_id: "q2", answer: "Autumn" } },
  ]);
});

const attention = [
  { id: "permission:perm1", kind: "permission", title: "sandbox: coder asks to run a command", body: "pnpm test", projectId: "p1", url: RUN_URL },
  { id: "question:q1", kind: "question", title: "sandbox: gate asks a question", body: "Which database?", projectId: "p1", url: RUN_URL },
  { id: `failed:exec1`, kind: "failed", title: "sandbox: run failed at coder", body: "Shaping tools", projectId: "p1", url: RUN_URL },
  { id: "review:exec2:90", kind: "review", title: "sandbox: PR #90 waits for your review", body: "Docs", projectId: "p1", url: RUN_URL },
  { id: `finished:${RUN}`, kind: "finished", title: "sandbox: run finished", body: "Fix the footer", projectId: "p1", url: RUN_URL },
];

test("list_attention groups its items as the Inbox does and answers permissions and questions inline from list_inbox", async () => {
  const { calls } = await mountView(startNeedsYou, { input: {}, result: textResult(attention), tools: { list_inbox: () => textResult(inbox) } });
  const list = await screen.findByRole("region", { name: "Needs you" });
  expect(within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
    "Permission requests1",
    "Questions to answer1",
    "Runs that stopped1",
    "Pull requests waiting for your review1",
    "Finished runs1",
  ]);
  // The permission and the question come with their buttons once list_inbox has their details.
  expect(await within(list).findByRole("button", { name: "Allow once" })).toBeInTheDocument();
  expect(within(list).getByRole("button", { name: "postgres" })).toBeInTheDocument();
  expect(calls).toEqual([{ name: "list_inbox", arguments: {} }]);
});

test("Dismiss takes a finished or failed run off the list with dismiss_attention", async () => {
  const { calls } = await mountView(startNeedsYou, { input: {}, result: textResult(attention), tools: { list_inbox: () => textResult(empty), dismiss_attention: () => textResult({ dismissed: true }) } });
  const card = within(await screen.findByRole("article", { name: "sandbox: run finished" }));
  fireEvent.click(card.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(card.getByRole("status")).toHaveTextContent("Dismissed."));
  expect(calls.at(-1)).toEqual({ name: "dismiss_attention", arguments: { item_id: `finished:${RUN}` } });
  expect(within(screen.getByRole("article", { name: "sandbox: run failed at coder" })).getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  // A permission prompt leaves the list once someone answers it.
  expect(screen.queryAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
});

test("with nothing waiting, the list says so", async () => {
  await mountView(startNeedsYou, { input: {}, result: textResult(empty) });
  expect(await screen.findByText("Nothing needs you")).toBeInTheDocument();
  expect(screen.getByText("Reviews, questions, runs that stopped and pull requests to review show up here.")).toBeInTheDocument();
});

test("a host that does not proxy tool calls gets the cards without their buttons, and a link to the run", async () => {
  await mountView(startNeedsYou, { input: {}, result: textResult(inbox), capabilities: { openLinks: {} } });
  const card = within(await screen.findByRole("article", { name: "coder asks to run a command" }));
  expect(card.queryByRole("button")).not.toBeInTheDocument();
  expect(card.getByRole("link", { name: "Open the run" })).toHaveAttribute("href", RUN_URL);
});

test("Open the run asks the host to open the dashboard", async () => {
  const { opened } = await mountView(startNeedsYou, { input: {}, result: textResult(inbox) });
  const card = within(await screen.findByRole("article", { name: "#88 Fix the footer" }));
  fireEvent.click(card.getByRole("link", { name: "Open the run" }));
  await waitFor(() => expect(opened).toEqual([RUN_URL]));
});

test("a tool error is shown as the error's text", async () => {
  await mountView(startNeedsYou, { input: {}, result: errorResult("There is no project nope.") });
  expect(await screen.findByRole("alert")).toHaveTextContent("There is no project nope.");
});

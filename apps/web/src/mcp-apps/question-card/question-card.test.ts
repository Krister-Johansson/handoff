import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { errorResult, mountView, textResult, unmountViews } from "../testing";
import { startQuestionCard } from "./main";

const RUN_URL = "http://localhost:3000/projects/p1/runs/7f3a2c1e-0000-4000-8000-000000000001";
const inbox = {
  permissions: [],
  reviews: [],
  questions: [{ id: "q1", project: "sandbox", run: "Add a CHANGELOG", node: "gate", question: "Which database?", options: ["postgres", "sqlite"], url: RUN_URL }],
  ready_to_merge: [],
  failed_runs: [],
  stuck_runs: [],
  pull_requests: [],
};

afterEach(unmountViews);

test("answer_question's card shows the question and the answer while it is sent, then that it is answered", async () => {
  const { bridge } = await mountView(startQuestionCard, { input: { question_id: "q1", option: "postgres", answer: "Postgres, as in production" }, tools: { list_inbox: () => textResult(inbox) } });
  const card = within(await screen.findByRole("article", { name: "Which database?" }));
  expect(card.getByText("gate")).toBeInTheDocument();
  expect(card.getByRole("status")).toHaveTextContent("Sending the answer…");
  expect(card.getByText("postgres: Postgres, as in production")).toBeInTheDocument();
  await bridge.sendToolResult(textResult({ answered: true, run_id: "7f3a2c1e-0000-4000-8000-000000000001", url: RUN_URL }));
  await waitFor(() => expect(within(screen.getByRole("article", { name: "Which database?" })).getByRole("status")).toHaveTextContent("Answered."));
  expect(screen.getByRole("link", { name: "Open the run" })).toHaveAttribute("href", RUN_URL);
});

test("a Try it verdict says how many criteria do not work", async () => {
  await mountView(startQuestionCard, {
    input: { question_id: "q-try", criteria: [{ criterion: "It saves", works: true }, { criterion: "It loads", works: false, note: "Blank page" }] },
    result: textResult({ answered: true, run_id: "r1", url: RUN_URL }),
    capabilities: { openLinks: {} },
  });
  const card = within(await screen.findByRole("article", { name: "Question" }));
  expect(card.getByText("Try it: 1 of 2 criteria do not work")).toBeInTheDocument();
  await waitFor(() => expect(card.getByRole("status")).toHaveTextContent("Answered."));
});

test("a refused or failed answer is shown as its error", async () => {
  await mountView(startQuestionCard, { input: { question_id: "q1", option: "mysql" }, result: errorResult('The question takes one of postgres, sqlite; "mysql" is not one of them.'), capabilities: {} });
  expect(await screen.findByRole("alert")).toHaveTextContent('"mysql" is not one of them.');
});

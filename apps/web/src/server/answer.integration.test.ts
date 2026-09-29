import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, questions } from "@handoff/db";
import { createTestDb, seedExecution, seedRun, truncateAll } from "@handoff/db/testing";
import { handleAnswer } from "./answer.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

test("answer route records the answer and a second answer gets 409", async () => {
  const { run } = await seedRun(db, { status: "waiting" });
  const exec = await seedExecution(db, run.id, { nodeKey: "gate", nodeType: "human_gate", executorKind: "human", status: "waiting" });
  const [q] = await db.insert(questions).values({ runId: run.id, nodeExecutionId: exec.id, question: "Q?" }).returning();
  expect((await handleAnswer(db, q!.id, post({ answer: "yes", option: "approve" }))).status).toBe(200);
  expect((await db.select().from(questions).where(eq(questions.id, q!.id)))[0]).toMatchObject({ answer: "yes", answeredBy: "dashboard" });
  expect((await handleAnswer(db, q!.id, post({ answer: "no" }))).status).toBe(409);
});

test("answer route rejects an empty answer", async () => {
  expect((await handleAnswer(db, crypto.randomUUID(), post({ answer: " " }))).status).toBe(400);
});

import { z } from "zod";
import type { Db } from "@handoff/db";
import { answerQuestion } from "@handoff/engine/operations";
import type { ProjectsPort } from "@handoff/github";

const Body = z.object({ answer: z.string().trim().min(1), option: z.string().optional(), answeredBy: z.string().default("dashboard") });

/** Answers a question. With the Projects port, an abort that cancels the run sets its tasks back on the plan. */
export async function handleAnswer(db: Db, questionId: string, request: Request, opts: { projects?: ProjectsPort | undefined } = {}): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: "answer is required" }, { status: 400 });
  try {
    const question = await answerQuestion(
      db,
      questionId,
      {
        answer: parsed.data.answer,
        answeredBy: parsed.data.answeredBy,
        ...(parsed.data.option ? { option: parsed.data.option } : {}),
      },
      opts,
    );
    return Response.json({ id: question.id, runId: question.runId });
  } catch (error) {
    const message = (error as Error).message;
    return Response.json({ error: message }, { status: message.includes("already answered") ? 409 : 404 });
  }
}

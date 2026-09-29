import { afterAll, beforeEach, expect, test } from "vitest";
import { appendEvents, eq, runs } from "@handoff/db";
import { createTestDb, seedRun, truncateAll } from "@handoff/db/testing";
import { eventsResponse } from "./events-stream.ts";

const db = createTestDb();
beforeEach(() => truncateAll(db));
afterAll(() => db.$client.end());

async function readFrames(response: Response, count: number): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const frames: string[] = [];
  while (frames.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = text.indexOf("\n\n")) !== -1) {
      const frame = text.slice(0, index);
      text = text.slice(index + 2);
      if (!frame.startsWith(":")) frames.push(frame);
    }
  }
  await reader.cancel();
  return frames;
}

test("events route streams rows after Last-Event-ID as SSE with id fields", async () => {
  const { run } = await seedRun(db);
  await db.transaction((tx) =>
    appendEvents(tx, run.id, [
      { type: "run.created", payload: {} },
      { type: "node.created", payload: { nodeKey: "planner" } },
      { type: "run.started", payload: {} },
    ]),
  );
  const controller = new AbortController();
  const request = new Request(`http://localhost/api/runs/${run.id}/events`, {
    headers: { "last-event-id": "1" },
    signal: controller.signal,
  });
  const response = eventsResponse(db, run.id, request, { pollMs: 20 });
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const frames = await readFrames(response, 2);
  controller.abort();
  expect(frames.map((f) => f.split("\n")[0])).toEqual(["id: 2", "id: 3"]);
  const data = JSON.parse(frames[0]!.split("\n").find((l) => l.startsWith("data: "))!.slice(6));
  expect(data).toMatchObject({ seq: 2, type: "node.created", payload: { nodeKey: "planner" } });
});

test("events route sends new events as they are appended", async () => {
  const { run } = await seedRun(db);
  const controller = new AbortController();
  const response = eventsResponse(db, run.id, new Request(`http://localhost/x?after=0`, { signal: controller.signal }), { pollMs: 20 });
  const pending = readFrames(response, 1);
  await new Promise((r) => setTimeout(r, 60));
  await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "node.claimed", payload: {} }]));
  const frames = await pending;
  controller.abort();
  expect(frames[0]).toContain("node.claimed");
});

test("events route ends the stream with an end event once a finished run is drained", async () => {
  const { run } = await seedRun(db);
  await db.transaction((tx) => appendEvents(tx, run.id, [{ type: "run.succeeded", payload: {} }]));
  await db.update(runs).set({ status: "succeeded" }).where(eq(runs.id, run.id));
  const response = eventsResponse(db, run.id, new Request("http://localhost/x"), { pollMs: 20 });
  const frames = await readFrames(response, 3);
  expect(frames).toHaveLength(2);
  expect(frames[1]).toContain("event: end");
});

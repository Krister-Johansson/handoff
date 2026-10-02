import { beforeEach, expect, test, vi } from "vitest";

const turnState = vi.hoisted(() => ({
  answer: vi.fn(() => true),
  answerUi: vi.fn(() => true),
  turn: { id: "t1", answer: undefined as unknown, answerUi: undefined as unknown, subscribe: vi.fn(() => () => {}) },
}));
const assistant = vi.hoisted(() => ({
  createConversation: vi.fn(async () => ({ id: "c1", title: "Hi" })),
  listConversations: vi.fn(async () => []),
  startTurn: vi.fn(async () => turnState.turn),
  stopTurn: vi.fn(),
  findTurn: vi.fn(() => turnState.turn),
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/github", () => ({ getGitHub: () => undefined }));
vi.mock("@/server/assistant/conversations", () => ({ createConversation: assistant.createConversation, listConversations: assistant.listConversations }));
vi.mock("@/server/assistant/turn", () => ({ startTurn: assistant.startTurn, stopTurn: assistant.stopTurn }));
vi.mock("@/server/assistant/relay", () => ({ findTurn: assistant.findTurn, TurnRunningError: class extends Error {} }));
vi.mock("@/server/assistant/live", () => ({ liveTurnDeps: () => ({ config: {} }), unavailableMessage: () => undefined }));

beforeEach(() => {
  for (const fn of Object.values(assistant)) fn.mockClear();
  turnState.turn.answer = turnState.answer;
  turnState.turn.answerUi = turnState.answerUi;
  turnState.answer.mockClear();
  turnState.answerUi.mockClear();
});

const post = (url: string, body: unknown, origin = "http://localhost:3000") =>
  new Request(url, { method: "POST", headers: { origin, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });

test("only the local dashboard may create a conversation, start a turn, answer a relay request or stop a turn", async () => {
  const conversations = await import("./conversations/route");
  const turns = await import("./conversations/[id]/turns/route");
  const replies = await import("./turns/[turnId]/replies/route");
  const stop = await import("./turns/[turnId]/stop/route");
  const evil = "https://evil.example";

  expect((await conversations.POST(post("http://localhost:3000/api/assistant/conversations", { text: "Hi" }, evil))).status).toBe(403);
  expect((await turns.POST(post("http://localhost:3000/api/assistant/conversations/c1/turns", { text: "Hi" }, evil), params({ id: "c1" }))).status).toBe(403);
  expect((await replies.POST(post("http://localhost:3000/api/assistant/turns/t1/replies", { requestId: "r1", approved: true }, evil), params({ turnId: "t1" }))).status).toBe(403);
  expect((await stop.POST(post("http://localhost:3000/api/assistant/turns/t1/stop", {}, evil), params({ turnId: "t1" }))).status).toBe(403);
  expect(assistant.createConversation).not.toHaveBeenCalled();
  expect(assistant.startTurn).not.toHaveBeenCalled();
  expect(turnState.answer).not.toHaveBeenCalled();
  expect(assistant.stopTurn).not.toHaveBeenCalled();

  expect((await conversations.POST(post("http://localhost:3000/api/assistant/conversations", { text: "Hi" }))).status).toBe(200);
  const started = await turns.POST(post("http://localhost:3000/api/assistant/conversations/c1/turns", { text: "Hi" }), params({ id: "c1" }));
  expect(started.headers.get("content-type")).toBe("text/event-stream");
  expect(assistant.startTurn).toHaveBeenCalledWith(expect.anything(), "c1", { text: "Hi", source: "typed" });
  expect((await replies.POST(post("http://localhost:3000/api/assistant/turns/t1/replies", { requestId: "r1", approved: false, note: "No" }), params({ turnId: "t1" }))).status).toBe(200);
  expect(turnState.answer).toHaveBeenCalledWith("r1", { approved: false, note: "No" });
  expect((await stop.POST(post("http://localhost:3000/api/assistant/turns/t1/stop", {}), params({ turnId: "t1" }))).status).toBe(200);
  expect(assistant.stopTurn).toHaveBeenCalled();
});

test("the page's answer to a UI tool call goes to the turn, and a body that is neither answer is refused", async () => {
  const replies = await import("./turns/[turnId]/replies/route");
  const url = "http://localhost:3000/api/assistant/turns/t1/replies";
  expect((await replies.POST(post(url, { requestId: "r2", result: "Opened Inbox (/inbox).", isError: false }), params({ turnId: "t1" }))).status).toBe(200);
  expect(turnState.answerUi).toHaveBeenCalledWith("r2", { text: "Opened Inbox (/inbox).", isError: false });
  expect(turnState.answer).not.toHaveBeenCalled();
  expect((await replies.POST(post(url, { requestId: "r3", result: 4 }), params({ turnId: "t1" }))).status).toBe(400);
  expect((await replies.POST(post(url, { requestId: "r2", result: "x" }, "https://evil.example"), params({ turnId: "t1" }))).status).toBe(403);
  turnState.answerUi.mockReturnValueOnce(false);
  expect((await replies.POST(post(url, { requestId: "r9", result: "late" }), params({ turnId: "t1" }))).status).toBe(410);
});

test("the turn stream starts with the turn's id in the shape the panel's transport reads", async () => {
  const turns = await import("./conversations/[id]/turns/route");
  const response = await turns.POST(post("http://localhost:3000/api/assistant/conversations/c1/turns", { text: "Hi" }), params({ id: "c1" }));
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  const data = first.split("\n").find((l) => l.startsWith("data: "))!;
  expect(JSON.parse(data.slice(6))).toEqual({ type: "turn", turnId: "t1" });
});

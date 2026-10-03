import { beforeEach, expect, test, vi } from "vitest";

const turnState = vi.hoisted(() => ({
  answer: vi.fn(() => true),
  answerUi: vi.fn(() => true),
  turn: { id: "t1", answer: undefined as unknown, answerUi: undefined as unknown, subscribe: vi.fn<(listener: (event: unknown) => void) => () => void>(() => () => {}) },
}));
const assistant = vi.hoisted(() => ({
  createConversation: vi.fn(async () => ({ id: "c1", title: "Hi" })),
  listChats: vi.fn(async () => ({ conversations: [] as unknown[], total: 0 })),
  getChat: vi.fn(async (): Promise<unknown> => undefined),
  conversationMessages: vi.fn(async () => [] as unknown[]),
  renameConversation: vi.fn(async () => true),
  setConversationPinned: vi.fn(async () => true),
  deleteConversation: vi.fn(async (): Promise<boolean> => true),
  startTurn: vi.fn(async () => turnState.turn),
  stopTurn: vi.fn(),
  findTurn: vi.fn((): unknown => turnState.turn),
}));
const errors = vi.hoisted(() => ({ ChatAnsweringError: class extends Error {} }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/github", () => ({ getGitHub: () => undefined }));
vi.mock("@/server/assistant/conversations", () => ({
  createConversation: assistant.createConversation,
  listChats: assistant.listChats,
  getChat: assistant.getChat,
  conversationMessages: assistant.conversationMessages,
  renameConversation: assistant.renameConversation,
  setConversationPinned: assistant.setConversationPinned,
  deleteConversation: assistant.deleteConversation,
  ChatAnsweringError: errors.ChatAnsweringError,
}));
vi.mock("@/server/assistant/turn", () => ({ startTurn: assistant.startTurn, stopTurn: assistant.stopTurn }));
vi.mock("@/server/assistant/relay", () => ({ findTurn: assistant.findTurn, TurnRunningError: class extends Error {} }));
vi.mock("@/server/assistant/live", () => ({ liveTurnDeps: () => ({ config: {} }), unavailableMessage: () => undefined }));

beforeEach(() => {
  for (const fn of Object.values(assistant)) fn.mockClear();
  turnState.turn.subscribe.mockReset().mockImplementation(() => () => {});
  turnState.turn.answer = turnState.answer;
  turnState.turn.answerUi = turnState.answerUi;
  turnState.answer.mockClear();
  turnState.answerUi.mockClear();
});

const post = (url: string, body: unknown, origin = "http://localhost:3000") =>
  new Request(url, { method: "POST", headers: { origin, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
const params = <T,>(value: T) => ({ params: Promise.resolve(value) });
const send = (method: string, url: string, body?: unknown, origin = "http://localhost:3000") =>
  new Request(url, { method, headers: { origin, host: "localhost:3000", "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const evil = "https://evil.example";

test("only the local dashboard may create a conversation, start a turn, answer a relay request or stop a turn", async () => {
  const conversations = await import("./conversations/route");
  const turns = await import("./conversations/[id]/turns/route");
  const replies = await import("./turns/[turnId]/replies/route");
  const stop = await import("./turns/[turnId]/stop/route");

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

test("a turn body's page is validated: unknown kinds and names are dropped and the turn still starts", async () => {
  const turns = await import("./conversations/[id]/turns/route");
  const start = async (page: unknown) => {
    assistant.startTurn.mockClear();
    const response = await turns.POST(post("http://localhost:3000/api/assistant/conversations/c1/turns", { text: "Open graph view", page }), params({ id: "c1" }));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    return (assistant.startTurn.mock.calls[0] as unknown[])[2];
  };
  const page = { kind: "run", path: "/projects/p1/runs/r1", heading: "Add a CHANGELOG.md", tools: ["page_show_view", "page_open_step"] };

  expect(await start(page)).toEqual({ text: "Open graph view", source: "typed", page });
  // A name the kind does not have, another page's tool, a catalog tool and a repeat are dropped.
  expect(await start({ ...page, tools: ["page_show_view", "page_invented", "page_save_graph", "cancel_run", "page_show_view", 7] })).toEqual({
    text: "Open graph view",
    source: "typed",
    page: { ...page, tools: ["page_show_view"] },
  });
  // An unknown kind, or a page that is not a page, starts the turn without one.
  expect(await start({ ...page, kind: "settings" })).toEqual({ text: "Open graph view", source: "typed" });
  expect(await start("the run page")).toEqual({ text: "Open graph view", source: "typed" });
  expect(await start({ ...page, path: "https://evil.example/x" })).toEqual({ text: "Open graph view", source: "typed" });
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

test("the list of chats takes a limit, a search and a project, and answers only the local dashboard", async () => {
  const conversations = await import("./conversations/route");
  const chat = { id: "c1", title: "Plan the voice epic", pinnedAt: null, project: null, lastMessage: "Hi", state: "answering" };
  assistant.listChats.mockResolvedValueOnce({ conversations: [chat], total: 24 });
  const response = await conversations.GET(send("GET", "http://localhost:3000/api/assistant/conversations?limit=6&q=voice&project=none"));
  expect(await response.json()).toEqual({ conversations: [chat], total: 24 });
  expect(assistant.listChats).toHaveBeenCalledWith(expect.anything(), { limit: 6, query: "voice", projectId: "none" });

  await conversations.GET(send("GET", "http://localhost:3000/api/assistant/conversations?limit=lots"));
  expect(assistant.listChats).toHaveBeenLastCalledWith(expect.anything(), {});
  expect((await conversations.GET(send("GET", "http://localhost:3000/api/assistant/conversations", undefined, evil))).status).toBe(403);
});

test("a new chat is started with the page it was started on", async () => {
  const conversations = await import("./conversations/route");
  await conversations.POST(post("http://localhost:3000/api/assistant/conversations", { text: "Hi", path: "/projects/p1/runs" }));
  expect(assistant.createConversation).toHaveBeenCalledWith(expect.anything(), "Hi", { path: "/projects/p1/runs" });
  await conversations.POST(post("http://localhost:3000/api/assistant/conversations", { text: "Hi", path: "https://evil.example/x" }));
  expect(assistant.createConversation).toHaveBeenLastCalledWith(expect.anything(), "Hi", {});
});

test("a chat comes with its project, state, running turn and messages; an unknown one is not found", async () => {
  const route = await import("./conversations/[id]/route");
  const url = "http://localhost:3000/api/assistant/conversations/c1";
  const chat = { id: "c1", title: "Hi", project: { id: "p1", name: "handoff" }, state: "approval", turnId: "t1" };
  assistant.getChat.mockResolvedValueOnce(chat);
  assistant.conversationMessages.mockResolvedValueOnce([{ id: "m1" }]);
  expect(await (await route.GET(send("GET", url), params({ id: "c1" }))).json()).toEqual({ conversation: chat, messages: [{ id: "m1" }] });
  expect((await route.GET(send("GET", url), params({ id: "c2" }))).status).toBe(404);
});

test("a chat is renamed, pinned and unpinned through PATCH", async () => {
  const route = await import("./conversations/[id]/route");
  const url = "http://localhost:3000/api/assistant/conversations/c1";
  expect((await route.PATCH(send("PATCH", url, { title: "Voice epic" }), params({ id: "c1" }))).status).toBe(200);
  expect(assistant.renameConversation).toHaveBeenCalledWith(expect.anything(), "c1", "Voice epic");
  expect((await route.PATCH(send("PATCH", url, { pinned: true }), params({ id: "c1" }))).status).toBe(200);
  expect(assistant.setConversationPinned).toHaveBeenCalledWith(expect.anything(), "c1", true);
  await route.PATCH(send("PATCH", url, { pinned: false }), params({ id: "c1" }));
  expect(assistant.setConversationPinned).toHaveBeenLastCalledWith(expect.anything(), "c1", false);

  // Nothing to change, or the wrong types, is refused before anything changes.
  for (const body of [{}, { title: 4 }, { pinned: "yes" }, "rename"]) expect((await route.PATCH(send("PATCH", url, body), params({ id: "c1" }))).status).toBe(400);
  expect(assistant.renameConversation).toHaveBeenCalledTimes(1);
  assistant.renameConversation.mockRejectedValueOnce(new Error("Give the chat a name."));
  const blank = await route.PATCH(send("PATCH", url, { title: "  " }), params({ id: "c1" }));
  expect([blank.status, await blank.json()]).toEqual([400, { error: "Give the chat a name." }]);
  assistant.setConversationPinned.mockResolvedValueOnce(false);
  expect((await route.PATCH(send("PATCH", url, { pinned: true }), params({ id: "c9" }))).status).toBe(404);
  expect((await route.PATCH(send("PATCH", url, { pinned: true }, evil), params({ id: "c1" }))).status).toBe(403);
});

test("deleting a chat removes it with its transcript, and is refused while it answers", async () => {
  const route = await import("./conversations/[id]/route");
  const url = "http://localhost:3000/api/assistant/conversations/c1";
  expect((await route.DELETE(send("DELETE", url), params({ id: "c1" }))).status).toBe(200);
  expect(assistant.deleteConversation).toHaveBeenCalledWith(expect.anything(), "c1", { configDir: expect.stringMatching(/assistant[/\\]claude-config$/) });
  assistant.deleteConversation.mockResolvedValueOnce(false);
  expect((await route.DELETE(send("DELETE", url), params({ id: "c9" }))).status).toBe(404);
  assistant.deleteConversation.mockRejectedValueOnce(new errors.ChatAnsweringError("This chat is answering."));
  expect((await route.DELETE(send("DELETE", url), params({ id: "c1" }))).status).toBe(409);
  assistant.deleteConversation.mockClear();
  expect((await route.DELETE(send("DELETE", url, undefined, evil), params({ id: "c1" }))).status).toBe(403);
  expect(assistant.deleteConversation).not.toHaveBeenCalled();
});

test("a running turn's events can be followed again from the start, as after a reload", async () => {
  const route = await import("./turns/[turnId]/events/route");
  const url = "http://localhost:3000/api/assistant/turns/t1/events";
  const events = [
    { type: "text", text: "On it." },
    { type: "confirm", requestId: "r1", toolUseId: "tu1", name: "cancel_run", title: "Cancel a run", summary: "Cancel run 1", args: {} },
    { type: "confirmed", requestId: "r1", approved: true },
    { type: "done", text: "Cancelled." },
  ];
  const unsubscribe = vi.fn();
  turnState.turn.subscribe.mockImplementationOnce((listener: (event: unknown) => void) => {
    for (const event of events) listener(event);
    return unsubscribe;
  });
  const response = await route.GET(send("GET", url), params({ turnId: "t1" }));
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const text = await response.text();
  const data = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  expect(data).toEqual([{ type: "turn", turnId: "t1" }, ...events]);
  expect(unsubscribe).toHaveBeenCalled();

  assistant.findTurn.mockReturnValueOnce(undefined);
  expect((await route.GET(send("GET", url), params({ turnId: "t9" }))).status).toBe(404);
  expect((await route.GET(send("GET", url, undefined, evil), params({ turnId: "t1" }))).status).toBe(403);
});

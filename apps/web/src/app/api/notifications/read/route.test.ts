import { expect, test, vi } from "vitest";
import { POST } from "./route";

const markNotificationsRead = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/server/notifications", () => ({ markNotificationsRead }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));

const post = (body: unknown, origin = "http://localhost:3000") =>
  POST(new Request("http://localhost:3000/api/notifications/read", { method: "POST", headers: { origin, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) }));

test("opening the bell marks the feed read up to the newest item it showed", async () => {
  const res = await post({ until: "2026-10-01T10:00:00.123Z" });
  expect(res.status).toBe(200);
  expect(markNotificationsRead).toHaveBeenCalledWith({}, new Date("2026-10-01T10:00:00.123Z"));
});

test("only the local dashboard may mark the feed read, and only with a time", async () => {
  expect((await post({ until: "2026-10-01T10:00:00Z" }, "https://evil.example")).status).toBe(403);
  expect((await post({ until: "yesterday" })).status).toBe(400);
  expect((await post({})).status).toBe(400);
});

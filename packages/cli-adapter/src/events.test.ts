import { expect, test } from "vitest";
import { toCliEvent } from "./events.ts";

test("toCliEvent names events by type and subtype", () => {
  expect(toCliEvent({ type: "system", subtype: "init", session_id: "s" }).type).toBe("cli.system.init");
  expect(toCliEvent({ type: "assistant", message: {} }).type).toBe("cli.assistant");
  expect(toCliEvent({ type: "result", subtype: "error_max_turns" }).type).toBe("cli.result.error_max_turns");
});

test("toCliEvent truncates oversized payloads with a marker", () => {
  const big = { type: "user", message: { content: "x".repeat(300_000) } };
  const event = toCliEvent(big, 1024);
  expect(JSON.stringify(event.payload).length).toBeLessThan(2048);
  expect(event.payload).toMatchObject({ truncated: true, type: "user" });
});

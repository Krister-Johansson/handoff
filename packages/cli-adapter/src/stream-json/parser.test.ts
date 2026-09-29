import { Readable } from "node:stream";
import { expect, test } from "vitest";
import { parseStreamJson } from "./parser.ts";

async function collect(chunks: string[]) {
  const out = [];
  for await (const line of parseStreamJson(Readable.from(chunks))) out.push(line);
  return out;
}

test("parser yields one typed line per JSON line", async () => {
  const out = await collect(['{"type":"system","subtype":"init","session_id":"s"}\n{"type":"result","subtype":"success"}\n']);
  expect(out.map((l) => l.type)).toEqual(["system", "result"]);
});

test("parser reassembles a line split across two chunks", async () => {
  const out = await collect(['{"type":"assis', 'tant","message":{}}\n']);
  expect(out).toEqual([{ type: "assistant", message: {} }]);
});

test("parser flushes a final line without a trailing newline and tolerates CRLF", async () => {
  const out = await collect(['{"type":"a"}\r\n{"type":"b"}']);
  expect(out.map((l) => l.type)).toEqual(["a", "b"]);
});

test("parser passes non-JSON stdout through as raw lines and skips blank lines", async () => {
  const out = await collect(["warning: something\n\n", '{"type":"x"}\n']);
  expect(out).toEqual([{ type: "raw", text: "warning: something" }, { type: "x" }]);
});

test("parser passes unknown event types through unchanged", async () => {
  const out = await collect(['{"type":"future_event","data":1}\n']);
  expect(out).toEqual([{ type: "future_event", data: 1 }]);
});

test("parser treats JSON without a string type as raw", async () => {
  const out = await collect(["[1,2]\n"]);
  expect(out).toEqual([{ type: "raw", text: "[1,2]" }]);
});

import type { RawLine, StreamJsonLine } from "./stream-json/parser.ts";
import type { CliEvent } from "./types.ts";

export const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;

export function toCliEvent(line: StreamJsonLine | RawLine, maxBytes = MAX_EVENT_PAYLOAD_BYTES): CliEvent {
  const type = `cli.${line.type}${"subtype" in line && typeof line.subtype === "string" ? `.${line.subtype}` : ""}`;
  const serialized = JSON.stringify(line);
  if (serialized.length <= maxBytes) return { type, payload: line };
  return {
    type,
    payload: {
      type: line.type,
      subtype: "subtype" in line ? line.subtype : undefined,
      truncated: true,
      originalBytes: serialized.length,
      preview: serialized.slice(0, Math.max(0, maxBytes - 512)),
    },
  };
}

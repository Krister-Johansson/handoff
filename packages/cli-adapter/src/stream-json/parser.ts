import type { Readable } from "node:stream";

export type StreamJsonLine = { type: string; subtype?: string; session_id?: string; [key: string]: unknown };
export type RawLine = { type: "raw"; text: string };

export function parseStreamJsonLine(line: string): StreamJsonLine | RawLine {
  try {
    const value: unknown = JSON.parse(line);
    if (value !== null && typeof value === "object" && !Array.isArray(value) && typeof (value as { type?: unknown }).type === "string") {
      return value as StreamJsonLine;
    }
  } catch {
    // fall through to raw
  }
  return { type: "raw", text: line };
}

/** Newline-delimited JSON over a stream. Buffers partial lines across chunks and flushes on end. */
export async function* parseStreamJson(stream: Readable): AsyncGenerator<StreamJsonLine | RawLine> {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line.trim() !== "") yield parseStreamJsonLine(line);
    }
  }
  const last = buffer.replace(/\r$/, "");
  if (last.trim() !== "") yield parseStreamJsonLine(last);
}

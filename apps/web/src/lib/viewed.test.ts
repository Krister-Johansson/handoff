import { expect, test } from "vitest";
import type { DiffFile } from "@handoff/core";
import { viewState } from "./viewed";

const file = (path: string, blob: string): DiffFile => ({ path, status: "modified", additions: 1, deletions: 0, blob, hunks: [] });
const at = (iso: string) => new Date(iso);

test("a file marked viewed at this blob is viewed", () => {
  expect(viewState(file("a.ts", "b2"), [{ path: "a.ts", blobSha: "b2", viewedAt: at("2026-10-01T10:00:00Z") }], {})).toEqual({ viewed: true });
});

test("a file the coder changed since it was viewed comes back unviewed", () => {
  expect(viewState(file("a.ts", "b2"), [{ path: "a.ts", blobSha: "b1", viewedAt: at("2026-10-01T10:00:00Z") }], {})).toEqual({ viewed: false, reason: "changed" });
});

test("a file commented on last round comes back unviewed even when unchanged, until it is viewed again", () => {
  const views = [{ path: "a.ts", blobSha: "b1", viewedAt: at("2026-10-01T10:00:00Z") }];
  expect(viewState(file("a.ts", "b1"), views, { "a.ts": at("2026-10-01T10:05:00Z") })).toEqual({ viewed: false, reason: "commented" });
  const again = [{ path: "a.ts", blobSha: "b1", viewedAt: at("2026-10-01T11:00:00Z") }];
  expect(viewState(file("a.ts", "b1"), again, { "a.ts": at("2026-10-01T10:05:00Z") })).toEqual({ viewed: true });
});

test("a file never viewed, or without a blob id, is not viewed", () => {
  expect(viewState(file("a.ts", "b1"), [], {})).toEqual({ viewed: false });
  expect(viewState({ ...file("a.ts", "b1"), blob: undefined } as DiffFile, [{ path: "a.ts", blobSha: "b1", viewedAt: at("2026-10-01T10:00:00Z") }], {})).toEqual({ viewed: false });
});

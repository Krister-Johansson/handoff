import { expect, test, vi } from "vitest";
import LibraryPage from "./page";

const redirect = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`redirect ${href}`);
  }),
);
vi.mock("next/navigation", () => ({ redirect }));

const open = (query: Record<string, string>) => LibraryPage({ searchParams: Promise.resolve(query) });

test("the old Library page redirects to its section of Settings, keeping the search", async () => {
  await expect(open({})).rejects.toThrow("redirect /settings?tab=skills");
  await expect(open({ tab: "mcp" })).rejects.toThrow("redirect /settings?tab=mcp");
  await expect(open({ tab: "agents", q: "review" })).rejects.toThrow("redirect /settings?tab=subagents&q=review");
  await expect(open({ tab: "groups" })).rejects.toThrow("redirect /settings?tab=groups");
});

import { expect, test, vi } from "vitest";
import { entryHeader } from "./library-entry-header";

vi.mock("@/lib/library-index", () => ({
  libraryIndex: async () => ({ skills: [], mcp: [], groups: [], agents: [{ name: "reviewer", version: 2 }] }),
}));

test("a library entry's trail leads back to its section of Settings, with a menu of the other sections", async () => {
  const { crumbs } = await entryHeader({ tab: "agents", title: "reviewer", subtitle: "", name: "reviewer", version: 2 });
  expect(crumbs[0]).toEqual({ label: "Settings", href: "/settings" });
  expect(crumbs[1]).toEqual({ label: "Library", href: "/settings?tab=skills" });
  expect(crumbs[2]).toMatchObject({ label: "Agents", href: "/settings?tab=subagents" });
  expect(crumbs[2]!.menu).toEqual([
    { label: "Skills", href: "/settings?tab=skills", current: false },
    { label: "Agents", href: "/settings?tab=subagents", current: true },
    { label: "MCP servers", href: "/settings?tab=mcp", current: false },
    { label: "Groups", href: "/settings?tab=groups", current: false },
  ]);
  expect(crumbs[3]).toMatchObject({ label: "reviewer", menu: [{ label: "reviewer", href: "/library/agents/reviewer", current: true, hint: "v2" }] });
});

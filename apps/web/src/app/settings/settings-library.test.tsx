import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import SettingsPage from "./page";

vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "localhost:3000" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/settings" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/github", () => ({ getProjects: () => undefined }));

const index = {
  skills: [
    { name: "tdd", description: "Test-driven development", version: 4, fileCount: 4, source: { registry: "github", id: "anthropics/skills/tdd", hash: "h" } },
    { name: "plan-format", description: "How a planner writes steps", version: 2, fileCount: 0, source: null },
  ],
  agents: [{ name: "reviewer", description: "Reviews a diff", version: 1 }],
  mcp: [{ name: "docs", transport: "http", url: "https://docs.example/mcp", command: null, args: [], version: 3, lastCheck: null }],
  groups: [{ name: "frontend", description: "", skills: ["tdd"], mcp: ["docs"], agents: [], version: 1 }],
};
const listLibraryIndex = vi.hoisted(() => vi.fn());
vi.mock("@handoff/db", () => ({ listLibraryIndex, liveWorkers: vi.fn() }));
listLibraryIndex.mockImplementation(async () => index);

// The other sections' reads; a library section never gets to them.
vi.mock("@/server/agent-endpoint", () => ({ lastAgentConnection: vi.fn() }));
vi.mock("@/server/assistant/conversations", () => ({ lastAssistantModel: vi.fn() }));
vi.mock("@/server/assistant/settings", () => ({ assistantState: vi.fn() }));
vi.mock("@/server/voice/elevenlabs", () => ({ elevenLabsConfig: vi.fn(), listElevenLabsVoices: vi.fn() }));
vi.mock("@/server/agent-token", () => ({ AgentTokenStore: vi.fn(), defaultAgentTokenFile: vi.fn() }));
vi.mock("@/server/workers", () => ({ workerSummary: vi.fn() }));
vi.mock("@/server/project-admin", () => ({ projectsForSettings: vi.fn() }));
vi.mock("@/server/scheduler-card", () => ({ schedulerStates: vi.fn() }));
vi.mock("@/app/projects/actions", () => ({}));
vi.mock("@/app/settings/actions", () => ({}));
vi.mock("@/app/projects/scheduler-actions", () => ({}));

const open = async (query: Record<string, string>) => render(await SettingsPage({ searchParams: Promise.resolve(query) }));

test("Settings, Library, Skills lists the skills by source, with search, Add skills and New skill in the card header", async () => {
  await open({ tab: "skills" });
  const nav = screen.getByRole("navigation", { name: "Settings sections" });
  expect(within(nav).getByRole("link", { name: "Skills" })).toHaveAttribute("aria-current", "page");
  const card = screen.getByRole("region", { name: "Skills" });
  expect(within(card).getByRole("searchbox", { name: "Search the library" })).toBeInTheDocument();
  expect(within(card).getByRole("link", { name: "Add skills" })).toHaveAttribute("href", "/library/skills/browse");
  expect(within(card).getByRole("link", { name: "New skill" })).toHaveAttribute("href", "/library/skills/new");
  expect(within(card).getByRole("link", { name: "tdd" })).toHaveAttribute("href", "/library/skills/tdd");
  expect(within(card).getByRole("region", { name: "anthropics/skills" })).toBeInTheDocument();
  expect(within(card).getByRole("region", { name: "Written here" })).toBeInTheDocument();
  // The search stays on this section.
  const form = within(card).getByRole("search");
  expect(form).toHaveAttribute("action", "/settings");
  expect(within(form).getByDisplayValue("skills")).toHaveAttribute("name", "tab");
});

test("Agents, MCP servers and Groups are sections of their own, each with its New button", async () => {
  await open({ tab: "subagents" });
  const agents = screen.getByRole("region", { name: "Agents" });
  expect(within(agents).getByRole("link", { name: "reviewer" })).toHaveAttribute("href", "/library/agents/reviewer");
  expect(within(agents).getByRole("link", { name: "New agent" })).toHaveAttribute("href", "/library/agents/new");
  expect(screen.queryByRole("region", { name: "Skills" })).not.toBeInTheDocument();

  await open({ tab: "mcp" });
  const mcp = screen.getByRole("region", { name: "MCP servers" });
  expect(within(mcp).getByRole("link", { name: "docs" })).toHaveAttribute("href", "/library/mcp/docs");
  expect(within(mcp).getByText("Not tested")).toBeInTheDocument();
  expect(within(mcp).getByRole("link", { name: "New MCP server" })).toHaveAttribute("href", "/library/mcp/new");

  await open({ tab: "groups" });
  const groups = screen.getByRole("region", { name: "Groups" });
  expect(within(groups).getByRole("link", { name: "frontend" })).toHaveAttribute("href", "/library/groups/frontend");
  expect(within(groups).getByRole("link", { name: "New group" })).toHaveAttribute("href", "/library/groups/new");
});

test("a search narrows the section and says when nothing matches", async () => {
  await open({ tab: "skills", q: "planner" });
  const card = screen.getByRole("region", { name: "Skills" });
  expect(within(card).getByRole("link", { name: "plan-format" })).toBeInTheDocument();
  expect(within(card).queryByRole("link", { name: "tdd" })).not.toBeInTheDocument();

  await open({ tab: "subagents", q: "nothing" });
  expect(within(screen.getByRole("region", { name: "Agents" })).getByText('No agents match "nothing"')).toBeInTheDocument();
});

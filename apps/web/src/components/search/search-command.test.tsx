import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SearchRecords, SearchTasks } from "@/lib/search/types";
import { SearchCommand } from "./search-command";

const env = vi.hoisted(() => ({
  push: vi.fn(),
  pathname: "/projects/p1/runs",
  records: vi.fn(),
  tasks: vi.fn(),
  showChat: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: env.push }), usePathname: () => env.pathname }));
vi.mock("@/app/search/actions", () => ({ searchRecordsAction: env.records, searchTasksAction: env.tasks }));
vi.mock("@/components/assistant/assistant-provider", () => ({ useOptionalAssistantPanel: () => ({ showChat: env.showChat }) }));

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const records = (opts: { flow?: boolean } = {}): SearchRecords => ({
  projectId: "p1",
  projects: [
    { id: "p1", name: "handoff", repo: "octo/handoff", planMode: opts.flow ? "flow" : "timeline", current: true },
    { id: "p2", name: "example-shop", repo: "acme/example-shop", planMode: "timeline", current: false },
  ],
  runs: [
    { id: "7f3a2c1e-1", shortId: "7f3a2c1e", projectId: "p1", title: "Shaping tools in the catalog", issues: [55], status: "running", branch: "feat/55-catalog", prNumber: null, at: opts.flow ? null : ago(14) },
    { id: "2b91d04a-1", shortId: "2b91d04a", projectId: "p1", title: "Approval card summaries for shaping", issues: [56], status: "waiting", branch: "feat/56-approval-cards", prNumber: null, at: opts.flow ? null : ago(60) },
    { id: "5d2e8c60-1", shortId: "5d2e8c60", projectId: "p1", title: "Plan read model and the Ready gate", issues: [53], status: "succeeded", branch: "feat/53-plan-read-model", prNumber: 88, at: opts.flow ? null : ago(2 * 24 * 60) },
    { id: "0e7d44b1-1", shortId: "0e7d44b1", projectId: "p1", title: "Plan mode switch in project settings", issues: [47], status: "failed", branch: "feat/47-plan-mode", prNumber: null, at: opts.flow ? null : ago(4 * 24 * 60) },
    { id: "e4b0a917-1", shortId: "e4b0a917", projectId: "p2", title: "Checkout keeps the cart after sign in", issues: [31], status: "running", branch: "feat/31-cart-sign-in", prNumber: null, at: ago(6) },
  ],
  chats: [
    { id: "c1", title: "Plan the voice epic", projectId: "p1", pinned: true, at: opts.flow ? null : ago(2 * 24 * 60) },
    { id: "c2", title: "Why checkout drops the cart", projectId: "p2", pinned: false, at: ago(3 * 24 * 60) },
  ],
});

const task = (number: number, title: string, extra: Partial<SearchTasks["tasks"][number]> = {}) => ({
  projectId: "p1",
  number,
  title,
  kind: "task" as const,
  status: "Ready" as const,
  state: "open" as const,
  parent: { number: 40, title: "Plans on GitHub Projects", kind: "story" as const },
  ...extra,
});
const planTasks: SearchTasks = {
  sources: [{ projectId: "p1", repo: "octo/handoff", source: "plan" }],
  tasks: [
    task(41, "Shaping tools for the assistant", { kind: "story", status: "Running" }),
    task(42, "Run feedback", { kind: "story", status: "Shaping" }),
    task(44, "Plan mode per project", { kind: "story", status: "In review" }),
    task(45, "Flow order with pins", { status: "Done" }),
    task(47, "Plan mode switch in project settings"),
    task(48, "Optimize the Flow order"),
    task(53, "Plan read model and the Ready gate", { status: "Done" }),
    task(60, "Planner asks its questions before it plans"),
  ],
};

beforeEach(() => {
  env.pathname = "/projects/p1/runs";
  env.records.mockResolvedValue(records());
  env.tasks.mockResolvedValue(planTasks);
});
afterEach(() => vi.restoreAllMocks());

function renderSearch(extra?: React.ReactNode) {
  return render(
    <TooltipProvider>
      <SearchCommand />
      {extra}
    </TooltipProvider>,
  );
}

async function openSearch(init: KeyboardEventInit = { ctrlKey: true }) {
  fireEvent.keyDown(document.body, { key: "k", ...init });
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  await waitFor(() => expect(env.tasks).toHaveBeenCalled());
  await act(async () => {});
  return dialog;
}

const input = () => screen.getByPlaceholderText("Search tasks, runs and pages");
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(input(), { key, ...init });
const group = (name: RegExp) => screen.getByRole("group", { name });
const optionsOf = (name: RegExp) => within(group(name)).getAllByRole("option").map((o) => o.textContent);
const selectedTab = () => screen.getByRole("tab", { selected: true });

test("Ctrl+K and Cmd+K open search over the page, which reads the project's data once as it opens", async () => {
  renderSearch();
  await openSearch({ ctrlKey: true });
  expect(env.records).toHaveBeenCalledWith({ projectId: "p1" });
  expect(env.tasks).toHaveBeenCalledWith({ projectId: "p1" });
  type("plan");
  type("plann");
  expect(env.tasks).toHaveBeenCalledTimes(1);

  press("Escape");
  press("Escape");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await openSearch({ metaKey: true });
});

test("Alt or Shift with K does not open search", () => {
  renderSearch();
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true, altKey: true });
  fireEvent.keyDown(document.body, { key: "k", metaKey: true, shiftKey: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("on a Mac the Search button reads ⌘K and Ctrl+K in a text field is left alone", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  renderSearch(<input aria-label="Notes" />);
  expect(screen.getByRole("button", { name: "Search" })).toHaveTextContent("Search⌘K");
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "k", ctrlKey: true });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Notes" }), { key: "k", metaKey: true });
  expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();
});

test("elsewhere the Search button reads Ctrl K and opens search", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  renderSearch();
  const button = screen.getByRole("button", { name: "Search" });
  expect(button).toHaveTextContent("SearchCtrlK");
  expect(button).toHaveAttribute("aria-keyshortcuts", "Control+K Meta+K");
  fireEvent.click(button);
  expect(await screen.findByRole("dialog", { name: "Search" })).toBeInTheDocument();
});

test("before typing, search shows the project's active runs and places to go, then what was opened from search", async () => {
  renderSearch();
  await openSearch();
  expect(screen.queryByRole("group", { name: /^Recent/ })).not.toBeInTheDocument();
  expect(optionsOf(/^Active runs/)).toEqual([expect.stringContaining("7f3a2c1eShaping tools in the catalog"), expect.stringContaining("2b91d04aApproval card summaries")]);
  expect(optionsOf(/^Go to/).map((t) => t!.replace(/(handoff|All projects)$/, ""))).toEqual(["Runs", "Plan", "Inbox", "Settings"]);
  expect(screen.getByText("Type # for a task number")).toBeInTheDocument();

  type("#53");
  press("Enter");
  expect(env.push).toHaveBeenCalledWith("/projects/p1/issues/53");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  await openSearch();
  expect(optionsOf(/^Recent/)).toEqual([expect.stringContaining("#53Plan read model and the Ready gate")]);
});

test("typing groups the results, 3 to a group with Show more, with each filter's count", async () => {
  renderSearch();
  await openSearch();
  type("plan");
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["All9", "Tasks4", "Runs2", "Pages2", "Chats1"]);
  expect(optionsOf(/^Tasks/)).toEqual([
    expect.stringContaining("#44Plan mode per project"),
    expect.stringContaining("#47Plan mode switch in project settings"),
    expect.stringContaining("#53Plan read model and the Ready gate"),
    "Show 1 more task",
  ]);
  expect(within(group(/^Tasks/)).getAllByRole("option")[0]).toHaveTextContent("Story #40 · Plans on GitHub Projects");
  expect(within(group(/^Tasks/)).getAllByRole("option")[0]).toHaveTextContent("In review");
  expect(within(within(group(/^Tasks/)).getAllByRole("option")[0]!).getByText("Plan").tagName).toBe("MARK");

  fireEvent.click(screen.getByRole("option", { name: "Show 1 more task" }));
  expect(within(group(/^Tasks/)).getAllByRole("option")).toHaveLength(4);
  expect(optionsOf(/^Runs/)[0]).toContain("#53 · feat/53-plan-read-model");
  expect(optionsOf(/^Runs/)[0]).toContain("2d");
});

test("Tab and Shift+Tab move between the filters while focus stays in the input", async () => {
  renderSearch();
  await openSearch();
  type("plan");
  press("Tab");
  expect(selectedTab()).toHaveTextContent(/^Tasks/);
  expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label") ?? "")).toHaveLength(1);
  expect(optionsOf(/^Tasks/)).toHaveLength(4);
  press("Tab");
  expect(selectedTab()).toHaveTextContent(/^Runs/);
  press("Tab", { shiftKey: true });
  press("Tab", { shiftKey: true });
  expect(selectedTab()).toHaveTextContent(/^All/);
  press("Tab", { shiftKey: true });
  expect(selectedTab()).toHaveTextContent(/^Chats/);
  expect(input()).toHaveFocus();
});

test("# filters to tasks by number, / to pages, and Backspace past the prefix returns to All", async () => {
  renderSearch();
  await openSearch();
  type("#4");
  expect(selectedTab()).toHaveTextContent(/^Tasks/);
  expect(screen.getAllByRole("option").map((o) => o.textContent!.slice(0, 3))).toEqual(["#41", "#42", "#44", "#45", "#47", "#48"]);
  expect(screen.getByText("Backspace past # shows all")).toBeInTheDocument();

  type("/sett");
  expect(selectedTab()).toHaveTextContent(/^Pages/);
  const pages = screen.getAllByRole("option").map((o) => o.textContent);
  expect(pages.slice(0, 2)).toEqual(["SettingsAll projects", "Project settingshandoff"]);
  expect(pages).toContain("Plan modehandoff › Project settings");

  type("");
  expect(selectedTab()).toHaveTextContent(/^All/);
});

test("Esc clears the query first, then closes", async () => {
  renderSearch();
  await openSearch();
  type("plan");
  press("Escape");
  expect(screen.getByRole("dialog", { name: "Search" })).toBeInTheDocument();
  expect(input()).toHaveValue("");
  press("Escape");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("Enter opens the selected result and Cmd+Enter or Ctrl+Enter opens it in a new tab", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  renderSearch();
  await openSearch();
  type("5d2e8c60");
  press("Enter", { ctrlKey: true });
  expect(open).toHaveBeenCalledWith("/projects/p1/runs/5d2e8c60-1", "_blank", "noopener");
  expect(env.push).not.toHaveBeenCalled();

  await openSearch();
  type("plan mode");
  press("ArrowDown");
  press("Enter");
  expect(env.push).toHaveBeenCalledWith("/projects/p1/issues/47");
});

test("a page opens its route and a chat opens in the assistant panel", async () => {
  renderSearch();
  await openSearch();
  type("/plan mode");
  press("Enter");
  expect(env.push).toHaveBeenCalledWith("/projects/p1/settings?tab=mode");

  await openSearch();
  type("voice epic");
  press("Enter");
  expect(env.showChat).toHaveBeenCalledWith("c1");
});

test("another project's runs, chats and name show under Other projects, with Search all projects", async () => {
  renderSearch();
  await openSearch();
  type("checkout");
  expect(screen.getByText('Nothing in handoff matches "checkout".')).toBeInTheDocument();
  expect(optionsOf(/^Other projects/)).toEqual([expect.stringContaining("Checkout keeps the cart after sign in"), expect.stringContaining("Why checkout drops the cart")]);
  expect(optionsOf(/^Other projects/)[0]).toContain("example-shop · #31 · feat/31-cart-sign-in");

  env.tasks.mockResolvedValue({ sources: [...planTasks.sources, { projectId: "p2", repo: "acme/example-shop", source: "plan" }], tasks: [...planTasks.tasks, { projectId: "p2", number: 31, title: "Checkout keeps the cart after sign in" }] });
  fireEvent.click(screen.getByRole("option", { name: /Search all projects for "checkout"/ }));
  await waitFor(() => expect(env.tasks).toHaveBeenLastCalledWith({ projectId: "p1", all: true }));
  expect(screen.getByRole("button", { name: "Searching all projects. Change" })).toBeInTheDocument();
  await waitFor(() => expect(optionsOf(/^Tasks/)[0]).toContain("#31Checkout keeps the cart after sign in"));
  expect(screen.queryByRole("group", { name: /^Other projects/ })).not.toBeInTheDocument();
});

test("no results offer all projects and the issue search on GitHub in a new tab", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  renderSearch();
  await openSearch();
  type("kubernetes");
  expect(screen.getByText('No results for "kubernetes"')).toBeInTheDocument();
  expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Search all projectsexample-shop too", "Search issues on GitHubocto/handoff, in a new tab"]);
  fireEvent.click(screen.getByRole("option", { name: /Search issues on GitHub/ }));
  expect(open).toHaveBeenCalledWith("https://github.com/octo/handoff/issues?q=kubernetes", "_blank", "noopener");
});

test("when GitHub does not answer, tasks come from runs without a status, with Try GitHub again", async () => {
  env.tasks.mockResolvedValue({
    sources: [{ projectId: "p1", repo: "octo/handoff", source: "runs", error: "GitHub did not answer: rate limited" }],
    tasks: [{ projectId: "p1", number: 53, title: "Plan read model and the Ready gate", fromRun: "5d2e8c60" }],
  });
  renderSearch();
  await openSearch();
  type("plan");
  expect(within(group(/^Tasks/)).getByText("GitHub did not answer. These tasks come from runs, without their status.")).toBeInTheDocument();
  expect(optionsOf(/^Tasks/)).toEqual(["#53Plan read model and the Ready gateFrom run 5d2e8c60", "Try GitHub again"]);

  env.tasks.mockResolvedValue(planTasks);
  fireEvent.click(screen.getByRole("option", { name: "Try GitHub again" }));
  await waitFor(() => expect(env.tasks).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(group(/^Tasks/)).queryByText(/GitHub did not answer/)).not.toBeInTheDocument());
});

test("a project without a plan lists its open issues under Issues", async () => {
  env.tasks.mockResolvedValue({ sources: [{ projectId: "p1", repo: "octo/handoff", source: "issues" }], tasks: [{ projectId: "p1", number: 12, title: "Plan the docs" }] });
  renderSearch();
  await openSearch();
  type("plan");
  expect(optionsOf(/^Issues/)).toEqual(["#12Plan the docs"]);
});

test("tasks show loading rows until GitHub answers", async () => {
  env.tasks.mockReturnValue(new Promise(() => {}));
  renderSearch();
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  await screen.findByRole("dialog", { name: "Search" });
  await act(async () => {});
  type("plan");
  expect(within(group(/^Tasks/)).getByLabelText("Loading tasks")).toBeInTheDocument();
  expect(optionsOf(/^Runs/)).toHaveLength(2);
});

test("the project chip picks another project or All projects", async () => {
  renderSearch();
  await openSearch();
  fireEvent.keyDown(screen.getByRole("button", { name: "Searching handoff. Change" }), { key: "Enter" });
  expect(screen.getAllByRole("menuitemradio").map((m) => m.textContent)).toEqual(["handoffThis project", "example-shop", "All projects"]);
  fireEvent.click(screen.getByRole("menuitemradio", { name: "example-shop" }));
  await waitFor(() => expect(env.records).toHaveBeenLastCalledWith({ projectId: "p2" }));
  expect(env.tasks).toHaveBeenLastCalledWith({ projectId: "p2" });
});

test("a Flow project's results show no dates", async () => {
  env.records.mockResolvedValue(records({ flow: true }));
  renderSearch();
  await openSearch();
  expect(optionsOf(/^Active runs/)[0]).not.toMatch(/\d+m$/);
  type("plan");
  expect(optionsOf(/^Runs/)[0]).not.toContain("2d");
  expect(optionsOf(/^Chats/)[0]).not.toContain("2d");
});

test("search works when this browser keeps no local storage", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  renderSearch();
  await openSearch();
  type("#53");
  press("Enter");
  expect(env.push).toHaveBeenCalledWith("/projects/p1/issues/53");
});

test("on a phone search fills the screen and Cancel closes it", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) => ({ matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }) as MediaQueryList,
  );
  renderSearch();
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  expect(screen.getByPlaceholderText("Search")).toBeInTheDocument();
  expect(dialog).toHaveAttribute("data-phone", "true");
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("across all projects, the GitHub notice names the projects GitHub did not answer for", async () => {
  renderSearch();
  await openSearch();
  env.tasks.mockResolvedValue({
    sources: [planTasks.sources[0]!, { projectId: "p2", repo: "acme/example-shop", source: "runs", error: "rate limited" }],
    tasks: [...planTasks.tasks, { projectId: "p2", number: 31, title: "Checkout keeps the cart after sign in", fromRun: "e4b0a917" }],
  });
  fireEvent.keyDown(screen.getByRole("button", { name: "Searching handoff. Change" }), { key: "Enter" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: "All projects" }));
  await waitFor(() => expect(env.tasks).toHaveBeenLastCalledWith({ projectId: "p1", all: true }));
  type("#");
  expect(await within(group(/^Tasks/)).findByText("GitHub did not answer for example-shop. Its tasks come from runs, without their status.")).toBeInTheDocument();
});

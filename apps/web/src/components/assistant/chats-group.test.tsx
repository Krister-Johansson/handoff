import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FakeAssistantTransport, fakeChat } from "@/lib/assistant/testing/fake-assistant-transport";
import { AssistantPanel } from "./assistant-panel";
import { AssistantProvider } from "./assistant-provider";
import { CHATS_COOKIE } from "@/lib/assistant/chats-cookie";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn() }) }));

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const handoff = { id: "p1", name: "handoff" };
const shop = { id: "p2", name: "example-shop" };

let transport: FakeAssistantTransport;
beforeEach(() => {
  nav.pathname = "/";
  document.cookie = `${CHATS_COOKIE}=; path=/; max-age=0`;
  transport = new FakeAssistantTransport();
  transport.conversations = [
    fakeChat({ id: "voice", title: "Plan the voice epic", project: handoff, pinnedAt: ago(10), updatedAt: ago(2 * 1440) }),
    fakeChat({ id: "week", title: "What needs me this week", pinnedAt: ago(10), updatedAt: ago(5 * 1440) }),
    fakeChat({ id: "shape", title: "Shaping tools run and story #41", project: handoff, updatedAt: ago(2) }),
    fakeChat({ id: "repair", title: "Repair the docs build", project: { id: "p3", name: "demo-docs" }, state: "approval", updatedAt: ago(14) }),
    fakeChat({ id: "size", title: "Size the tasks in story #42", project: handoff, state: "answering", updatedAt: ago(0) }),
    fakeChat({ id: "queue", title: "Merge queue for example-shop", project: shop, updatedAt: ago(180) }),
    fakeChat({ id: "f03", title: "Why the F03 plan was sent back", project: shop, updatedAt: ago(1440) }),
    fakeChat({ id: "gc", title: "Clean up old worktrees", updatedAt: ago(2 * 1440) }),
    fakeChat({ id: "old", title: "An older chat", updatedAt: ago(9 * 1440) }),
  ];
});

function renderSidebar({ open = true, chatsOpen = true }: { open?: boolean; chatsOpen?: boolean } = {}) {
  return render(
    <TooltipProvider>
      <AssistantProvider transport={transport} available>
        <SidebarProvider defaultOpen={open}>
          <AppSidebar projects={[]} inboxCount={0} worker={{ live: 1, queuedRuns: 0 }} chatsOpen={chatsOpen} />
          <AssistantPanel />
        </SidebarProvider>
      </AssistantProvider>
    </TooltipProvider>,
  );
}

const rows = (name: string) => within(screen.getByRole("list", { name })).getAllByRole("listitem");
const rowOf = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) }).closest("li")!;
const openMenu = (title: string) => fireEvent.keyDown(within(rowOf(title)).getByRole("button", { name: `Actions for ${title}` }), { key: "Enter" });

test("Chats lists every pinned chat, then the six most recent others, each with its project and time, or its state", async () => {
  renderSidebar();
  const chats = screen.getByRole("region", { name: "Chats" });
  await within(chats).findByRole("list", { name: "Pinned chats" });
  expect(transport.lists[0]).toEqual({ limit: 6 });
  expect(rows("Pinned chats").map((r) => r.textContent)).toEqual([expect.stringMatching(/^Plan the voice epic2d/), expect.stringMatching(/^What needs me this week5d/)]);
  expect(rows("Recent chats").map((r) => r.textContent)).toEqual([
    expect.stringMatching(/^Shaping tools run and story #412m/),
    expect.stringMatching(/^Repair the docs buildApprove/),
    expect.stringMatching(/^Size the tasks in story #42Answering/),
    expect.stringMatching(/^Merge queue for example-shop3h/),
    expect.stringMatching(/^Why the F03 plan was sent back1d/),
    expect.stringMatching(/^Clean up old worktrees2d/),
  ]);
  // The tile shows the project's letter; a chat outside any project has none.
  expect(rowOf("Repair the docs build").querySelector("[data-letter]")).toHaveAttribute("data-letter", "d");
  expect(rowOf("Clean up old worktrees").querySelector("[data-letter]")).toBeNull();
  // A row's tooltip gives its full title, project and when it was used.
  expect(within(rowOf("Clean up old worktrees")).getByRole("button", { name: "Clean up old worktrees" })).toHaveAttribute("title", "Clean up old worktrees, All projects, 2 days ago");
  const all = within(chats).getByRole("link", { name: "View all, 9 chats" });
  expect(all).toHaveAttribute("href", "/chats");
});

test("a row opens its chat in the panel, and the pen starts a new chat", async () => {
  transport.stored.set("shape", {
    conversation: { ...transport.conversations[2]!, turnId: null },
    messages: [{ id: "m1", role: "user", content: { text: "How is the shaping run going?", source: "typed" } }],
  });
  renderSidebar();
  fireEvent.click(await screen.findByRole("button", { name: "Shaping tools run and story #41" }));
  const panel = await screen.findByRole("dialog", { name: "Assistant" });
  expect(await within(panel).findByText("How is the shaping run going?")).toBeInTheDocument();
  expect(within(panel).getByRole("heading", { level: 2, name: "Shaping tools run and story #41" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Shaping tools run and story #41" })).toHaveAttribute("aria-current", "true");

  fireEvent.click(within(screen.getByRole("region", { name: "Chats" })).getByRole("button", { name: "New chat" }));
  expect(within(panel).getByRole("heading", { level: 2, name: "New chat" })).toBeInTheDocument();
});

test("the row menu pins and unpins a chat", async () => {
  renderSidebar();
  await screen.findByRole("list", { name: "Pinned chats" });
  openMenu("Merge queue for example-shop");
  fireEvent.click(await screen.findByRole("menuitem", { name: "Pin" }));
  await waitFor(() => expect(rows("Pinned chats").map((r) => r.textContent)).toContainEqual(expect.stringContaining("Merge queue for example-shop")));
  expect(transport.pins).toEqual([{ id: "queue", pinned: true }]);

  openMenu("Plan the voice epic");
  fireEvent.click(await screen.findByRole("menuitem", { name: "Unpin" }));
  await waitFor(() => expect(transport.pins).toEqual([{ id: "queue", pinned: true }, { id: "voice", pinned: false }]));
});

test("Rename edits the title in place: Enter saves, Escape cancels, and F2 on a row starts it", async () => {
  renderSidebar();
  await screen.findByRole("list", { name: "Pinned chats" });
  openMenu("Merge queue for example-shop");
  fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
  const field = await screen.findByRole("textbox", { name: "Chat name" });
  await waitFor(() => expect(field).toHaveFocus());
  fireEvent.change(field, { target: { value: "Merge queue" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(transport.renames).toEqual([{ id: "queue", title: "Merge queue" }]));
  expect(await screen.findByRole("button", { name: "Merge queue" })).toBeInTheDocument();

  fireEvent.keyDown(screen.getByRole("button", { name: "Repair the docs build" }), { key: "F2" });
  const again = await screen.findByRole("textbox", { name: "Chat name" });
  fireEvent.change(again, { target: { value: "Something else" } });
  fireEvent.keyDown(again, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "Chat name" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Repair the docs build" })).toBeInTheDocument();
  expect(transport.renames).toHaveLength(1);
});

test("Shift+F10 on a row opens its menu", async () => {
  renderSidebar();
  fireEvent.keyDown(await screen.findByRole("button", { name: "Repair the docs build" }), { key: "F10", shiftKey: true });
  expect(await screen.findByRole("menuitem", { name: "Pin" })).toBeInTheDocument();
});

test("Delete asks first, then deletes the chat; deleting the open chat leaves a new chat in the panel", async () => {
  transport.stored.set("queue", { conversation: { ...transport.conversations[5]!, turnId: null }, messages: [] });
  renderSidebar();
  fireEvent.click(await screen.findByRole("button", { name: "Merge queue for example-shop" }));
  const panel = await screen.findByRole("dialog", { name: "Assistant" });
  await within(panel).findByRole("heading", { level: 2, name: "Merge queue for example-shop" });

  openMenu("Merge queue for example-shop");
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
  const ask = await screen.findByRole("alertdialog", { name: "Delete this chat?" });
  expect(ask).toHaveTextContent('"Merge queue for example-shop" and its messages are deleted. Runs, issues and plans it changed stay as they are.');
  fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
  expect(transport.removes).toEqual([]);

  openMenu("Merge queue for example-shop");
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
  fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Delete this chat?" })).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(transport.removes).toEqual(["queue"]));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Merge queue for example-shop" })).not.toBeInTheDocument());
  expect(within(panel).getByRole("heading", { level: 2, name: "New chat" })).toBeInTheDocument();
});

test("the Chats label folds both lists and remembers it", async () => {
  renderSidebar();
  const toggle = screen.getByRole("button", { name: "Chats" });
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  await screen.findByRole("list", { name: "Recent chats" });
  act(() => toggle.click());
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("list", { name: "Recent chats" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /View all/ })).not.toBeInTheDocument();
  expect(document.cookie).toContain(`${CHATS_COOKIE}=false`);
});

test("folded from the start, the lists stay folded until the label opens them", async () => {
  renderSidebar({ chatsOpen: false });
  expect(screen.getByRole("button", { name: "Chats" })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("list", { name: "Recent chats" })).not.toBeInTheDocument();
  act(() => screen.getByRole("button", { name: "Chats" }).click());
  expect(await screen.findByRole("list", { name: "Recent chats" })).toBeInTheDocument();
  expect(document.cookie).toContain(`${CHATS_COOKIE}=true`);
});

test("collapsed to icons, Chats is a New chat button and a link to the Chats page", async () => {
  renderSidebar({ open: false });
  const chats = screen.getByRole("navigation", { name: "Chats" });
  expect(within(chats).getByRole("button", { name: "New chat" })).toBeInTheDocument();
  expect(await within(chats).findByRole("link", { name: "Chats, 9" })).toHaveAttribute("href", "/chats");
  expect(screen.queryByRole("list", { name: "Recent chats" })).not.toBeInTheDocument();
});

test("on the Chats page View all is the current page", async () => {
  nav.pathname = "/chats";
  renderSidebar();
  expect(await screen.findByRole("link", { name: "View all, 9 chats" })).toHaveAttribute("aria-current", "page");
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FakeAssistantTransport, fakeChat } from "@/lib/assistant/testing/fake-assistant-transport";
import { AssistantPanel } from "./assistant-panel";
import { AssistantProvider } from "./assistant-provider";
import { ChatsTable, NewChatButton } from "./chats-page";

vi.mock("next/navigation", () => ({ usePathname: () => "/chats", useRouter: () => ({ push: vi.fn() }) }));

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const handoff = { id: "p1", name: "handoff" };
const docs = { id: "p3", name: "demo-docs" };
const PROJECTS = [handoff, docs];

let transport: FakeAssistantTransport;
beforeEach(() => {
  transport = new FakeAssistantTransport();
  transport.conversations = [
    fakeChat({ id: "voice", title: "Plan the voice epic", project: handoff, pinnedAt: ago(5), updatedAt: ago(2 * 1440), lastMessage: "Scheduled the four stories from Monday." }),
    fakeChat({ id: "shape", title: "Shaping tools run and story #41", project: handoff, updatedAt: ago(2), lastMessage: "#56 waits for your review." }),
    fakeChat({ id: "repair", title: "Repair the docs build", project: docs, state: "approval", updatedAt: ago(14), lastMessage: "On it." }),
    fakeChat({ id: "size", title: "Size the tasks in story #42", project: handoff, state: "answering", updatedAt: ago(0) }),
    fakeChat({ id: "week", title: "What needs me this week", updatedAt: ago(9 * 1440), lastMessage: "Two reviews and one question wait on you." }),
  ];
});

function renderPage() {
  return render(
    <TooltipProvider>
      <AssistantProvider transport={transport} available>
        <NewChatButton />
        <ChatsTable projects={PROJECTS} />
        <AssistantPanel />
      </AssistantProvider>
    </TooltipProvider>,
  );
}

const table = () => screen.getByRole("table", { name: "Chats" });
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);

test("pinned chats come first, then this week's and older ones, with project, last message and when", async () => {
  renderPage();
  await waitFor(() => expect(within(table()).getAllByRole("row").length).toBeGreaterThan(1));
  const rows = within(table()).getAllByRole("row").slice(1);
  expect(rows.map((r) => cells(r).slice(0, 4))).toEqual([
    ["Pinned"],
    ["Plan the voice epic", "handoff", "Scheduled the four stories from Monday.", "2 days ago"],
    ["This week"],
    ["Shaping tools run and story #41", "handoff", "#56 waits for your review.", "2 minutes ago"],
    ["Repair the docs build", "demo-docs", "Waiting for your approval", "14 minutes ago"],
    ["Size the tasks in story #42", "handoff", "Answering", "just now"],
    ["Older"],
    ["What needs me this week", "All projects", "Two reviews and one question wait on you.", "9 days ago"],
  ]);
  expect(screen.getByText("5 chats")).toBeInTheDocument();
  expect(transport.lists.at(-1)).toMatchObject({ limit: 500 });
});

test("search covers titles and messages, and the project filter takes a project or All projects for chats outside one", async () => {
  renderPage();
  await screen.findByText("5 chats");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), { target: { value: "voice" } });
  await waitFor(() => expect(screen.getByText("1 chat")).toBeInTheDocument());
  expect(transport.lists.at(-1)).toMatchObject({ query: "voice" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search chats" }), { target: { value: "" } });

  const filter = screen.getByRole("combobox", { name: "Project" });
  expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual(["All", "handoff", "demo-docs", "All projects"]);
  fireEvent.change(filter, { target: { value: "p3" } });
  await waitFor(() => expect(screen.getByText("1 chat")).toBeInTheDocument());
  expect(within(table()).getByRole("button", { name: "Repair the docs build" })).toBeInTheDocument();
  fireEvent.change(filter, { target: { value: "none" } });
  await waitFor(() => expect(within(table()).getByRole("button", { name: "What needs me this week" })).toBeInTheDocument());
  expect(transport.lists.at(-1)).toMatchObject({ projectId: "none" });
});

test("a chat opens in the panel and the page stays; New chat starts one", async () => {
  renderPage();
  fireEvent.click(await within(await screen.findByRole("table", { name: "Chats" })).findByRole("button", { name: "Plan the voice epic" }));
  const panel = await screen.findByRole("dialog", { name: "Assistant" });
  expect(await within(panel).findByRole("heading", { level: 2, name: "Plan the voice epic" })).toBeInTheDocument();
  expect(table()).toBeInTheDocument();

  // The page's New chat, not the one in the panel's header.
  fireEvent.click(screen.getAllByRole("button", { name: "New chat" }).find((b) => !screen.getByRole("dialog", { name: "Assistant" }).contains(b))!);
  expect(within(screen.getByRole("dialog", { name: "Assistant" })).getByRole("heading", { level: 2, name: "New chat" })).toBeInTheDocument();
});

test("the row menu matches the sidebar's: pin, rename in place and delete after asking", async () => {
  renderPage();
  const actions = await within(await screen.findByRole("table", { name: "Chats" })).findByRole("button", { name: "Actions for Repair the docs build" });
  fireEvent.keyDown(actions, { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Pin" }));
  await waitFor(() => expect(transport.pins).toEqual([{ id: "repair", pinned: true }]));
  await waitFor(() => expect(cells(within(table()).getAllByRole("row")[3]!)[0]).toBe("Repair the docs build"));

  fireEvent.keyDown(within(table()).getByRole("button", { name: "Actions for What needs me this week" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /Rename/ }));
  const field = await screen.findByRole("textbox", { name: "Chat name" });
  fireEvent.change(field, { target: { value: "This week" } });
  fireEvent.keyDown(field, { key: "Enter" });
  await waitFor(() => expect(transport.renames).toEqual([{ id: "week", title: "This week" }]));

  fireEvent.keyDown(within(table()).getByRole("button", { name: "Actions for Plan the voice epic" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
  fireEvent.click(within(await screen.findByRole("alertdialog", { name: "Delete this chat?" })).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(within(table()).queryByRole("button", { name: "Plan the voice epic" })).not.toBeInTheDocument());
  expect(transport.removes).toEqual(["voice"]);
});

test("with no chats the page says so", async () => {
  transport.conversations = [];
  renderPage();
  expect(await screen.findByText("No chats yet")).toBeInTheDocument();
});

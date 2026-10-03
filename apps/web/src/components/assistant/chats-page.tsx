"use client";

import { useEffect, useState } from "react";
import { EllipsisIcon, PinIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChatList, ConversationSummary } from "@/lib/assistant/transport";
import { formatAgo } from "@/lib/format";
import { useAssistantPanel } from "./assistant-provider";
import { ChatMenu, DeleteChatDialog, RenameField, useChatRow } from "./chat-actions";
import { NO_PROJECT, ProjectTile } from "./chat-bits";

/** How many chats the page reads at most; gc keeps the list short. */
const PAGE_LIMIT = 500;
const WEEK_MS = 7 * 86_400_000;

/** The page's New chat: opens the panel on a new chat. */
export function NewChatButton() {
  const panel = useAssistantPanel();
  return (
    <Button type="button" onClick={panel.startChat}>
      <SquarePenIcon data-icon="inline-start" />
      New chat
    </Button>
  );
}

/** What the Last message column says: the chat's state while one matters, else the start of its last message. */
function lastLine(chat: ConversationSummary) {
  if (chat.state === "approval") return "Waiting for your approval";
  if (chat.state === "answering") return "Answering";
  return chat.lastMessage ?? "";
}

function ChatTableRow({ chat, onOpen }: { chat: ConversationSummary; onOpen: () => void }) {
  const { menuOpen, setMenuOpen, renaming, setRenaming, doneRenaming, deleting, setDeleting, title, onKeyDown } = useChatRow();
  return (
    <TableRow>
      <TableCell className="max-w-[320px] pl-5">
        <div className="flex min-w-0 items-center gap-2 [&_svg]:size-[13px] [&_svg]:flex-none [&_svg]:text-muted-foreground">
          {chat.pinnedAt && <PinIcon aria-label="Pinned" />}
          {renaming ? (
            <RenameField chat={chat} onDone={doneRenaming} />
          ) : (
            <button ref={title} type="button" className="truncate text-left font-medium hover:underline" onClick={onOpen} onKeyDown={onKeyDown}>
              {chat.title}
            </button>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-foreground/85">
          <ProjectTile project={chat.project} />
          {chat.project?.name ?? NO_PROJECT}
        </span>
      </TableCell>
      <TableCell className="max-w-[340px] truncate text-muted-foreground">{lastLine(chat)}</TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">{formatAgo(new Date(chat.updatedAt))}</TableCell>
      <TableCell className="w-10 text-right">
        <ChatMenu
          chat={chat}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onRename={() => setRenaming(true)}
          onDelete={() => setDeleting(true)}
          trigger={
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Actions for ${chat.title}`}>
              <EllipsisIcon />
            </Button>
          }
        />
        <DeleteChatDialog chat={chat} open={deleting} onOpenChange={setDeleting} />
      </TableCell>
    </TableRow>
  );
}

/** Pinned chats first, then the chats used this week, then older ones. */
function groupsOf(chats: ConversationSummary[], now: number) {
  const pinned = chats.filter((c) => c.pinnedAt);
  const rest = chats.filter((c) => !c.pinnedAt);
  const week = rest.filter((c) => now - new Date(c.updatedAt).getTime() < WEEK_MS);
  const older = rest.filter((c) => now - new Date(c.updatedAt).getTime() >= WEEK_MS);
  return [
    { label: "Pinned", chats: pinned },
    { label: "This week", chats: week },
    { label: "Older", chats: older },
  ].filter((g) => g.chats.length > 0);
}

/**
 * The Chats page's list: every chat across projects, pinned first and then by last use, with search
 * over titles and messages and a project filter (All projects is the chats started outside a
 * project). Opening a chat shows it in the panel and keeps this page. The row menu is the sidebar's.
 */
export function ChatsTable({ projects }: { projects: { id: string; name: string }[] }) {
  const panel = useAssistantPanel();
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [list, setList] = useState<ChatList>();
  const [now, setNow] = useState(() => Date.now());
  const { listChats, chatsVersion } = panel;
  useEffect(() => {
    let current = true;
    listChats({ limit: PAGE_LIMIT, ...(query.trim() ? { query: query.trim() } : {}), ...(project ? { projectId: project } : {}) }).then(
      (next) => {
        if (!current) return;
        setList(next);
        setNow(Date.now());
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [listChats, query, project, chatsVersion]);
  const filtered = Boolean(query.trim() || project);
  const total = list?.total ?? 0;
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-5">
        <InputGroup className="h-[30px] w-full sm:w-[280px]">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput type="search" aria-label="Search chats" placeholder="Search chats" value={query} onChange={(e) => setQuery(e.target.value)} />
        </InputGroup>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Project
          <NativeSelect size="sm" value={project} onChange={(e) => setProject(e.target.value)}>
            <NativeSelectOption value="">All</NativeSelectOption>
            {projects.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.name}
              </NativeSelectOption>
            ))}
            <NativeSelectOption value="none">{NO_PROJECT}</NativeSelectOption>
          </NativeSelect>
        </label>
        {list && <span className="ml-auto text-xs text-muted-foreground">{total === 1 ? "1 chat" : `${total} chats`}</span>}
      </div>
      {list && list.conversations.length === 0 ? (
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyTitle>{filtered ? "No chats match" : "No chats yet"}</EmptyTitle>
            <EmptyDescription>{filtered ? "Try other words, or another project." : "Start one with New chat, or from the assist button in the corner."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table aria-label="Chats">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Chat</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Last message</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupsOf(list?.conversations ?? [], now).map((group) => [
              <TableRow key={group.label} className="bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={5} className="py-1.5 pl-5 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
                  {group.label}
                </TableCell>
              </TableRow>,
              ...group.chats.map((chat) => <ChatTableRow key={chat.id} chat={chat} onOpen={() => void panel.showChat(chat.id)} />),
            ])}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

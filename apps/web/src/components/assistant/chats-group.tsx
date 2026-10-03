"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, EllipsisIcon, MessagesSquareIcon, PinIcon, SquarePenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { formatAgo, formatAgoShort } from "@/lib/format";
import { rememberChatsOpen } from "@/lib/assistant/chats-cookie";
import type { ConversationSummary } from "@/lib/assistant/transport";
import { cn } from "@/lib/utils";
import { useOptionalAssistantPanel } from "./assistant-provider";
import { ChatMenu, DeleteChatDialog, RenameField, useChatRow } from "./chat-actions";
import { ChatStateChip, NO_PROJECT, ProjectTile } from "./chat-bits";


/** One chat in the sidebar: its project, its title and a short time, or its state while one matters. */
function ChatRow({ chat, current, onOpen }: { chat: ConversationSummary; current: boolean; onOpen: () => void }) {
  const { menuOpen, setMenuOpen, renaming, setRenaming, doneRenaming, deleting, setDeleting, title, onKeyDown } = useChatRow();
  const when = new Date(chat.updatedAt);
  return (
    <li
      className={cn(
        "group/chat relative flex h-[30px] min-w-0 items-center gap-2 rounded-md pr-1 pl-2 text-[13px] text-sidebar-foreground/85 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        (current || menuOpen || renaming) && "bg-sidebar-accent text-sidebar-accent-foreground",
        current && "font-medium",
      )}
    >
      <ProjectTile project={chat.project} />
      {renaming ? (
        <RenameField chat={chat} onDone={doneRenaming} />
      ) : (
        <>
          <button
            ref={title}
            type="button"
            aria-current={current ? "true" : undefined}
            title={`${chat.title}, ${chat.project?.name ?? NO_PROJECT}, ${formatAgo(when)}`}
            className="min-w-0 flex-1 truncate text-left outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-ring"
            onClick={onOpen}
            onKeyDown={onKeyDown}
          >
            {chat.title}
          </button>
          <span className={cn("flex-none group-focus-within/chat:hidden group-hover/chat:hidden", menuOpen && "hidden")}>
            {chat.state ? <ChatStateChip state={chat.state} /> : <span className="min-w-[26px] pr-1 text-right text-[11px] font-normal text-muted-foreground tabular-nums">{formatAgoShort(when)}</span>}
          </span>
          <ChatMenu
            chat={chat}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            onRename={() => setRenaming(true)}
            onDelete={() => setDeleting(true)}
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions for ${chat.title}`}
                className={cn("relative hidden flex-none text-muted-foreground group-focus-within/chat:flex group-hover/chat:flex", menuOpen && "flex")}
              >
                <EllipsisIcon />
              </Button>
            }
          />
        </>
      )}
      <DeleteChatDialog chat={chat} open={deleting} onOpenChange={setDeleting} />
    </li>
  );
}


/** Collapsed to icons, Chats is two buttons: New chat, and Chats, which opens the Chats page. */
function ChatsIcons({ total, current, onNew }: { total: number; current: boolean; onNew: () => void }) {
  return (
    <SidebarGroup>
      <nav aria-label="Chats">
        <SidebarMenu className="gap-0.5">
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="New chat" aria-label="New chat" className="text-muted-foreground" onClick={onNew}>
              <SquarePenIcon />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={current} tooltip={`Chats, ${total}`} className="text-muted-foreground data-active:text-sidebar-accent-foreground">
              <Link href="/chats" aria-label={`Chats, ${total}`} aria-current={current ? "page" : undefined}>
                <MessagesSquareIcon />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  );
}

/** One list of the group, under its small label: Pinned or Recents. */
function ChatList({ label, name, chats, openId, onOpen }: { label: ReactNode; name: string; chats: ConversationSummary[]; openId: string | undefined; onOpen: (id: string) => void }) {
  if (!chats.length) return null;
  return (
    <>
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-[3px] text-[11.5px] text-muted-foreground [&_svg]:size-[11px]">{label}</div>
      <ul aria-label={name} className="flex flex-col gap-px">
        {chats.map((chat) => (
          <ChatRow key={chat.id} chat={chat} current={chat.id === openId} onOpen={() => onOpen(chat.id)} />
        ))}
      </ul>
    </>
  );
}

/** View all, with how many chats there are; it opens the Chats page. */
function ViewAll({ total, current, onFollow }: { total: number; current: boolean; onFollow: () => void }) {
  return (
    <Link
      href="/chats"
      aria-label={`View all, ${total} chats`}
      aria-current={current ? "page" : undefined}
      onClick={onFollow}
      className={cn(
        "mt-px flex h-[30px] items-center gap-2 rounded-md px-2 text-[12.5px] text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-3.5",
        current && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      <MessagesSquareIcon aria-hidden />
      View all
      <span className="ml-auto text-[11px] font-normal text-muted-foreground tabular-nums">{total}</span>
    </Link>
  );
}

/**
 * The sidebar's Chats group, under All projects: chats from every project, Pinned first, then the six
 * most recent in Recents, and View all for the Chats page. The label folds both lists and a cookie
 * keeps that. Collapsed to icons it is New chat and a link to the Chats page. Outside an assistant
 * provider it shows nothing.
 */
export function ChatsGroup({ initialOpen = true, pathname }: { initialOpen?: boolean; pathname: string }) {
  const panel = useOptionalAssistantPanel();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(initialOpen);
  const refresh = panel?.refreshChats;
  useEffect(() => {
    void refresh?.();
  }, [refresh]);
  if (!panel) return null;
  const chats = panel.chats?.conversations ?? [];
  const total = panel.chats?.total ?? 0;
  const onChats = pathname === "/chats";
  // On a phone the sidebar is a sheet; opening a chat or a page closes it.
  const openChat = (id: string) => {
    setOpenMobile(false);
    void panel.showChat(id);
  };
  const newChat = () => {
    setOpenMobile(false);
    panel.startChat();
  };
  if (state === "collapsed" && !isMobile) return <ChatsIcons total={total} current={onChats} onNew={newChat} />;
  const fold = () => {
    setOpen(!open);
    rememberChatsOpen(!open);
  };
  return (
    <section aria-label="Chats" className="mx-2 flex flex-col border-t border-sidebar-border py-2">
      <div className="flex h-7 items-center gap-0.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="chat-lists"
          className="inline-flex h-7 items-center gap-1 rounded-md pr-1.5 pl-2 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase outline-none hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&_svg]:size-3"
          onClick={fold}
        >
          Chats
          {open ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
        </button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" className="ml-auto text-muted-foreground" onClick={newChat}>
          <SquarePenIcon />
        </Button>
      </div>
      {open && (
        <div id="chat-lists" className="flex flex-col">
          <ChatList
            label={
              <>
                <PinIcon aria-hidden />
                Pinned
              </>
            }
            name="Pinned chats"
            chats={chats.filter((c) => c.pinnedAt)}
            openId={panel.conversationId}
            onOpen={openChat}
          />
          <ChatList label="Recents" name="Recent chats" chats={chats.filter((c) => !c.pinnedAt)} openId={panel.conversationId} onOpen={openChat} />
          {panel.chats && chats.length === 0 && <p className="px-2 pt-2 text-[12.5px] text-muted-foreground">No chats yet.</p>}
          {total > 0 && <ViewAll total={total} current={onChats} onFollow={() => setOpenMobile(false)} />}
        </div>
      )}
    </section>
  );
}

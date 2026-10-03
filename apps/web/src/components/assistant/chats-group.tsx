"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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


/**
 * One chat in the sidebar: its project, its title and a short time, or its state while one matters.
 * The actions button takes the time's place while the pointer is on the row or focus is in it, and
 * always on a touch screen, which has no hover.
 */
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
          <span className={cn("flex-none group-focus-within/chat:hidden group-hover/chat:hidden [@media(hover:none)]:hidden", menuOpen && "hidden")}>
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
                className={cn("relative hidden flex-none text-muted-foreground group-focus-within/chat:flex group-hover/chat:flex [@media(hover:none)]:flex", menuOpen && "flex")}
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

/**
 * Calls `onEnd` when the element the returned ref goes on comes within a few rows of the end of the
 * scroll area `root`, and again after each read while it stays in view and `more` holds.
 */
function useEndOfList(root: RefObject<HTMLElement | null>, more: boolean, count: number, onEnd: () => void) {
  const end = useRef<HTMLDivElement>(null);
  const latest = useRef(onEnd);
  useEffect(() => {
    latest.current = onEnd;
  });
  useEffect(() => {
    const target = end.current;
    if (!more || !target || typeof IntersectionObserver === "undefined") return;
    // A new observer reports at once, so a list shorter than its area keeps reading until it fills it.
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && latest.current(), { root: root.current, rootMargin: "0px 0px 120px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [root, more, count]);
  return end;
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
 * The sidebar's Chats group, under All projects: chats from every project, Pinned first, then Recents,
 * and View all for the Chats page. Both lists scroll in the room the sidebar has left, so the pages
 * above and Settings below stay put, and Recents reads more chats as it scrolls to its end. The label
 * folds both lists and a cookie keeps that. Collapsed to icons it is New chat and a link to the Chats
 * page. Outside an assistant provider it shows nothing.
 */
export function ChatsGroup({ initialOpen = true, pathname }: { initialOpen?: boolean; pathname: string }) {
  const panel = useOptionalAssistantPanel();
  const { state, isMobile, setOpenMobile } = useSidebar();
  const [open, setOpen] = useState(initialOpen);
  const refresh = panel?.refreshChats;
  useEffect(() => {
    void refresh?.();
  }, [refresh]);
  const scroller = useRef<HTMLDivElement>(null);
  const chats = panel?.chats?.conversations ?? [];
  const end = useEndOfList(scroller, panel?.moreChats ?? false, chats.length, () => void panel?.showMoreChats());
  if (!panel) return null;
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
    <section aria-label="Chats" className={cn("mx-2 flex flex-col border-t border-sidebar-border py-2", open && "min-h-0")}>
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
        <div id="chat-lists" className="flex min-h-0 flex-col">
          <div ref={scroller} className="-mx-1 min-h-0 overflow-y-auto overscroll-contain px-1 [scrollbar-color:var(--sidebar-border)_transparent] [scrollbar-width:thin]">
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
            {panel.moreChats && <div ref={end} aria-hidden className="h-px" />}
            {panel.chats && chats.length === 0 && <p className="px-2 pt-2 text-[12.5px] text-muted-foreground">No chats yet.</p>}
          </div>
          {total > 0 && <ViewAll total={total} current={onChats} onFollow={() => setOpenMobile(false)} />}
        </div>
      )}
    </section>
  );
}

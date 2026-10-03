"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssistantTransport, ChatList, ChatListQuery } from "@/lib/assistant/transport";

/** How many more unpinned chats the sidebar's Recents reads each time its list scrolls to the end. */
export const RECENT_CHATS = 30;

/** How often the list is read again while a chat in it answers or waits for an approval. */
const BUSY_POLL_MS = 5_000;

/**
 * The chats as the sidebar shows them (every pinned chat, the most recent others, and how many there
 * are), and the changes to them: rename, pin and delete. Recents starts with 30 chats and `showMore`
 * reads 30 more; reading the list again keeps as many as it showed. `version` changes with every change
 * made here, so a page with its own list (the Chats page) can read it again. While a listed chat
 * answers or waits, the list is read again every few seconds, so its state ends when its turn does.
 */
export function useChatList(transport: AssistantTransport) {
  const [chats, setChats] = useState<ChatList>();
  const [version, setVersion] = useState(0);
  const reads = useRef(0);
  const limit = useRef(RECENT_CHATS);

  const refresh = useCallback(async () => {
    const read = ++reads.current;
    try {
      const list = await transport.list({ limit: limit.current });
      if (read === reads.current) setChats(list);
    } catch {
      // The list stays as it was; the next change reads it again.
    }
  }, [transport]);

  /** A change to the chats: read the list again and tell other lists. */
  const changed = useCallback(async () => {
    setVersion((v) => v + 1);
    await refresh();
  }, [refresh]);

  const rename = useCallback(
    async (id: string, title: string) => {
      await transport.rename(id, title);
      await changed();
    },
    [transport, changed],
  );
  const pin = useCallback(
    async (id: string, pinned: boolean) => {
      await transport.pin(id, pinned);
      await changed();
    },
    [transport, changed],
  );
  const remove = useCallback(
    async (id: string) => {
      await transport.remove(id);
      await changed();
    },
    [transport, changed],
  );
  const list = useCallback((query: ChatListQuery) => transport.list(query), [transport]);

  /** Whether some chats are not in the list yet. */
  const more = chats ? chats.conversations.length < chats.total : false;
  /** Reads the next chats into Recents; nothing when every chat is in the list or a read for more runs. */
  const growing = useRef(false);
  const showMore = useCallback(async () => {
    if (!more || growing.current) return;
    growing.current = true;
    limit.current += RECENT_CHATS;
    try {
      await refresh();
    } finally {
      growing.current = false;
    }
  }, [more, refresh]);

  const busy = chats?.conversations.some((c) => c.state) ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refresh(), BUSY_POLL_MS);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  return useMemo(
    () => ({ chats, version, refresh, changed, rename, pin, remove, list, more, showMore }),
    [chats, version, refresh, changed, rename, pin, remove, list, more, showMore],
  );
}

/** The cookie that keeps the sidebar's Chats group folded or open, as sidebar_state keeps the sidebar. */
export const CHATS_COOKIE = "sidebar_chats";

/** Remembers whether the Chats group is open, for the layout to read on the next request. */
export function rememberChatsOpen(open: boolean) {
  document.cookie = `${CHATS_COOKIE}=${open}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

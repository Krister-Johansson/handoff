"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { PencilIcon, PinIcon, PinOffIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ConversationSummary } from "@/lib/assistant/transport";
import { cn } from "@/lib/utils";
import { useAssistantPanel } from "./assistant-provider";

const failed = (error: unknown) => toast.error((error as Error).message || "That did not work.");

/**
 * What a chat row can do besides opening: its menu (Pin or Unpin, Rename, Delete), renaming in place
 * and the question before a delete. F2 on the row starts Rename; Shift+F10 or the context menu key
 * opens the menu. The sidebar and the Chats page share it.
 */
export function useChatRow() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const title = useRef<HTMLButtonElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "F2") {
      e.preventDefault();
      setRenaming(true);
    } else if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") {
      e.preventDefault();
      setMenuOpen(true);
    }
  };
  const doneRenaming = () => {
    setRenaming(false);
    setTimeout(() => title.current?.focus(), 0);
  };
  return { menuOpen, setMenuOpen, renaming, setRenaming, doneRenaming, deleting, setDeleting, title, onKeyDown };
}

/** The row's actions button and its menu. Rename and Delete hand focus to the field or the question, not back to the button. */
export function ChatMenu({
  chat,
  open,
  onOpenChange,
  onRename,
  onDelete,
  trigger,
}: {
  chat: ConversationSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
  onDelete: () => void;
  trigger: ReactNode;
}) {
  const panel = useAssistantPanel();
  const keepFocus = useRef(false);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        className="w-52"
        onCloseAutoFocus={(e) => {
          if (keepFocus.current) e.preventDefault();
          keepFocus.current = false;
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void panel.pinChat(chat.id, !chat.pinnedAt).catch(failed)}>
            {chat.pinnedAt ? <PinOffIcon /> : <PinIcon />}
            {chat.pinnedAt ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              keepFocus.current = true;
              onRename();
            }}
          >
            <PencilIcon />
            Rename
            <DropdownMenuShortcut>F2</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              keepFocus.current = true;
              onDelete();
            }}
          >
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The chat's name as a field: Enter saves, Escape cancels, leaving the field saves a changed name. */
export function RenameField({ chat, onDone, className }: { chat: ConversationSummary; onDone: () => void; className?: string }) {
  const panel = useAssistantPanel();
  const field = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const name = field.current?.value.trim() ?? "";
    if (save && name && name !== chat.title) void panel.renameChat(chat.id, name).catch(failed);
    onDone();
  };
  return (
    <input
      ref={field}
      aria-label="Chat name"
      defaultValue={chat.title}
      maxLength={80}
      className={cn("h-6 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 text-[13px] text-foreground outline-2 outline-ring", className)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          // The panel and voice also listen for Escape; this one only cancels the rename.
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

/** Asks before a chat is deleted; the chat's work stays. */
export function DeleteChatDialog({ chat, open, onOpenChange }: { chat: ConversationSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const panel = useAssistantPanel();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
          <AlertDialogDescription>
            &quot;{chat.title}&quot; and its messages are deleted. Runs, issues and plans it changed stay as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void panel.deleteChat(chat.id).catch(failed)}>
            <Trash2Icon data-icon="inline-start" />
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

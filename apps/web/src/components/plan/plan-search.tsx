"use client";

import { useEffect, useEffectEvent, useRef, type KeyboardEvent } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";
import { matchParts, type MatchPart } from "@/lib/plan/search";
import { cn } from "@/lib/utils";
import { useSearchQuery } from "./plan-context";

/** Each part's offset in the text, which keys it. */
function offsets(parts: MatchPart[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const part of parts) {
    starts.push(at);
    at += part.text.length;
  }
  return starts;
}

/** Text with what the search found in it marked in yellow. */
export function Highlight({ text }: { text: string }) {
  const q = useSearchQuery();
  if (!q) return <>{text}</>;
  const parts = matchParts(text, q);
  const starts = offsets(parts);
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={starts[i]} className="-mx-px rounded-[2px] bg-highlight px-px text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={starts[i]}>{part.text}</span>
        ),
      )}
    </>
  );
}


const countText = (n: number) => (n === 0 ? "No match" : n === 1 ? "1 match" : `${n} matches`);

/** Whether a key press lands in a place that takes text, where / is a character and not the shortcut. */
function inTextField(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/**
 * The plan's search field: the icon, the text, the match count as a polite live region, and Clear. / focuses
 * it from anywhere on the page outside a text field. Escape clears the text, and in an empty field moves
 * focus to the plan; Enter or Down moves it to the first match.
 */
export function PlanSearchField({
  value,
  onChange,
  count,
  hint = true,
  onLeave,
  onFirstMatch,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** What matched in the view shown; read while there is text. */
  count: number;
  /** Whether the empty field shows the / hint. */
  hint?: boolean;
  /** Escape in the empty field. */
  onLeave: () => void;
  /** Enter or Down with text. */
  onFirstMatch: () => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const onSlash = useEffectEvent((e: globalThis.KeyboardEvent) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || inTextField(e.target)) return;
    e.preventDefault();
    input.current?.focus();
    input.current?.select();
  });
  useEffect(() => {
    const listener = (e: globalThis.KeyboardEvent) => onSlash(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      // The field handles Escape itself, so the plan around it does not clear the search a second time.
      e.stopPropagation();
      if (value) onChange("");
      else onLeave();
    } else if ((e.key === "Enter" || e.key === "ArrowDown") && value.trim()) {
      e.preventDefault();
      onFirstMatch();
    }
  };

  return (
    <InputGroup className={cn("h-7 bg-background dark:bg-input/30", className)}>
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        ref={input}
        type="search"
        aria-label="Search the plan"
        placeholder="Title or #number"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className="h-full text-[13px] [&::-webkit-search-cancel-button]:hidden"
      />
      <InputGroupAddon align="inline-end" className="gap-1">
        <span role="status" aria-live="polite" className="text-[11.5px] font-normal whitespace-nowrap tabular-nums">
          {value.trim() ? countText(count) : ""}
        </span>
        {value ? (
          <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => onChange("")}>
            <XIcon />
          </InputGroupButton>
        ) : (
          hint && <Kbd className="group-focus-within/input-group:hidden">/</Kbd>
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}

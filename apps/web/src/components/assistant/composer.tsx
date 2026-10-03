"use client";

import { useState, type ReactNode } from "react";
import { MicIcon, SquareIcon } from "lucide-react";
import { useOptionalVoice } from "@/components/voice/voice-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAssistant } from "./assistant-provider";

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-4 min-w-4 place-items-center rounded border border-b-2 bg-background px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>;
}

/**
 * Where the person writes to the assistant. Enter sends and Shift+Enter starts a new line; Stop ends a
 * reply while it streams. The panel closes on Escape when there is nothing written. The microphone
 * dictates into the message box and keeps focus there, as Ctrl+M does; while dictation goes into it,
 * a chip says so.
 */
export function Composer() {
  const { status, composerRef, send: sendMessage, stop } = useAssistant();
  const voice = useOptionalVoice();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const streaming = status === "streaming";
  const listening = voice?.mode === "dictation" && (voice.state === "listening" || voice.state === "starting");
  const dictating = focused && listening;
  const send = () => {
    if (!text.trim() || streaming) return;
    void sendMessage(text, { source: "typed" });
    setText("");
  };
  const dictate = () => {
    if (!voice) return;
    if (listening) return voice.stop();
    composerRef.current?.focus();
    void voice.start("dictation");
  };
  return (
    <div className={cn("flex flex-col rounded-md border bg-subtle transition-shadow", focused && "outline-2 outline-offset-1 outline-ring")}>
      <Label htmlFor="assistant-composer" className="sr-only">
        Message the assistant
      </Label>
      <textarea
        id="assistant-composer"
        ref={composerRef}
        rows={2}
        value={text}
        placeholder="Ask about your runs, or tell it what to do"
        className="min-h-12 resize-none bg-transparent px-[11px] pt-[9px] pb-0.5 text-[13px] leading-[1.45] outline-none placeholder:text-muted-foreground/70"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center gap-1.5 py-1.5 pr-1.5 pl-[11px]">
        {dictating ? (
          <span className="mr-auto inline-flex h-[22px] items-center gap-1.5 rounded-full bg-active-bg px-2 text-[11px] font-medium text-active [&_svg]:size-3">
            <MicIcon aria-hidden />
            Dictating
          </span>
        ) : (
          // On a phone the hints give way; there is no keyboard to press them on.
          <span className="mr-auto flex items-center gap-1 text-[11px] whitespace-nowrap text-muted-foreground/80 max-md:invisible">
            <Kbd>Enter</Kbd>sends
            {voice?.supported && (
              <>
                <span className="w-1.5" />
                <Kbd>Ctrl</Kbd>
                <Kbd>M</Kbd>dictates
              </>
            )}
          </span>
        )}
        {voice?.supported && (
          <Button
            type="button"
            variant={listening ? "default" : "ghost"}
            size="icon-sm"
            className={cn("text-muted-foreground", listening && "rounded-full text-primary-foreground")}
            aria-label={listening ? "Stop dictating" : "Dictate"}
            aria-pressed={listening}
            title={listening ? "Stop dictating (Ctrl+M or Escape)" : "Dictate (Ctrl+M)"}
            // Clicking keeps focus in the message box, so the words go there.
            onMouseDown={(e) => e.preventDefault()}
            onClick={dictate}
          >
            <MicIcon />
          </Button>
        )}
        {streaming ? (
          <Button type="button" size="xs" variant="outline" onClick={() => void stop()}>
            <SquareIcon data-icon="inline-start" />
            Stop
          </Button>
        ) : (
          <Button type="button" size="xs" disabled={!text.trim()} onClick={send}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}

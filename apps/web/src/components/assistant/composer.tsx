"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAssistant } from "./assistant-provider";

/**
 * Where the person writes to the assistant. Enter sends and Shift+Enter starts a new line; Stop ends a
 * reply while it streams; Escape closes the panel when there is nothing written.
 */
export function Composer() {
  const { status, composerRef, send: sendMessage, stop, close } = useAssistant();
  const [text, setText] = useState("");
  const streaming = status === "streaming";
  const send = () => {
    if (!text.trim() || streaming) return;
    void sendMessage(text, { source: "typed" });
    setText("");
  };
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="assistant-composer" className="sr-only">
        Message the assistant
      </Label>
      <Textarea
        id="assistant-composer"
        ref={composerRef}
        rows={3}
        value={text}
        placeholder="Ask about your runs, or tell it what to do"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
          if (e.key === "Escape" && !text) close();
        }}
      />
      <div className="flex justify-end gap-2">
        {streaming ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void stop()}>
            Stop
          </Button>
        ) : (
          <Button type="button" size="sm" disabled={!text.trim()} onClick={send}>
            Send
          </Button>
        )}
      </div>
    </div>
  );
}

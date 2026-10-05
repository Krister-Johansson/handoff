"use client";

import { InfoIcon } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CODE_EDITORS, useCodeEditor, writeCodeEditor, type CodeEditor } from "@/lib/code-editor";
import { cn } from "@/lib/utils";

/** The editor that the Open in button on a run page and a code review opens the run's worktree in, kept in this browser. */
export function CodeEditorSetting() {
  const editor = useCodeEditor();
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup value={editor} onValueChange={(value) => writeCodeEditor(value as CodeEditor)} aria-label="Code editor" className="flex max-w-[560px] flex-col gap-0 overflow-hidden rounded-lg border">
        {CODE_EDITORS.map(({ value, label, scheme }) => (
          <label
            key={value}
            className={cn("flex cursor-pointer items-center gap-3 border-t px-3.5 py-2.5 text-[13px] transition-colors first:border-t-0 hover:bg-muted/50 has-focus-visible:bg-muted/50", editor === value && "bg-muted")}
          >
            <RadioGroupItem value={value} aria-label={label} />
            <span className="font-medium">{label}</span>
            <span className="ml-auto font-mono text-[11.5px] text-muted-foreground">{`${scheme}://file/`}</span>
          </label>
        ))}
      </RadioGroup>
      <p className="flex max-w-[560px] items-start gap-2 text-xs leading-normal text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>The editor has to be installed on this machine. Your browser may ask before it opens it the first time.</span>
      </p>
    </div>
  );
}

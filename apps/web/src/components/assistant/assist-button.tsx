"use client";

import type { Ref } from "react";
import { ChevronDownIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useModKey } from "@/lib/platform";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The assist button in the bottom right corner: it opens the assistant, and while the panel floats it
 * hides it again. A dot says an approval card waits in some chat. Cmd+J does the same at every width.
 */
export function AssistButton({
  ref,
  expanded,
  waiting,
  available,
  onClick,
}: {
  ref?: Ref<HTMLButtonElement>;
  /** The panel floats open above the button, which then hides it. */
  expanded: boolean;
  waiting: boolean;
  available: boolean;
  onClick: () => void;
}) {
  const mod = useModKey();
  const label = expanded ? "Hide the assistant" : waiting ? "Assistant, an approval waits" : "Assistant";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={ref}
            type="button"
            size="icon-lg"
            aria-label={label}
            aria-expanded={expanded}
            data-slot="assist-button"
            className="fixed right-4 bottom-4 z-40 size-12 rounded-full shadow-lg md:right-6 md:bottom-6 [&_svg:not([class*='size-'])]:size-5"
            onClick={onClick}
          >
            {expanded ? <ChevronDownIcon /> : <MessageSquareIcon />}
            {waiting && !expanded && <span aria-hidden className="absolute top-px right-px size-3 rounded-full bg-attention-dot ring-2 ring-background" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left" className="flex items-center gap-1.5">
          {expanded ? "Hide" : available ? "Assistant" : "Assistant (off)"}
          <Kbd>{mod}</Kbd>
          <Kbd>J</Kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

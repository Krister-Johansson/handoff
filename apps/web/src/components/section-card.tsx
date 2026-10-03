import type { ReactNode } from "react";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * A card with a title, a description and an action in its header, and its content flush to the edges:
 * rows, a table or a padded body. Pages build their sections from it.
 */
export function SectionCard({
  title,
  description,
  action,
  actionBelowOnNarrow,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Under 1024 px the action goes under the description and wraps, for a wide action such as a search with buttons. */
  actionBelowOnNarrow?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      {(title || description || action) && (
        <CardHeader className={cn("gap-0.5 px-5 py-4", actionBelowOnNarrow && "max-lg:grid-cols-1!")}>
          {title && (
            <CardTitle className="text-sm font-semibold">
              <h2>{title}</h2>
            </CardTitle>
          )}
          {description && <CardDescription className="text-[13px]">{description}</CardDescription>}
          {action && (
            <CardAction
              className={cn(
                "flex items-center gap-2",
                actionBelowOnNarrow && "flex-wrap max-lg:col-start-1 max-lg:row-span-1 max-lg:row-start-auto max-lg:mt-2.5 max-lg:justify-self-stretch",
              )}
            >
              {action}
            </CardAction>
          )}
        </CardHeader>
      )}
      {children}
    </Card>
  );
}

/** Padding for a card's body below its header. */
export const CARD_BODY = "px-5 pb-4";

/** Rows in a card, divided by lines and lit on hover. */
export const ROWS = "flex flex-col divide-y";
export const ROW = "flex min-w-0 items-center gap-3 px-5 py-2.5 hover:bg-muted";

/** Table header and cell padding that line up with a card's header. */
export const TH = "h-auto px-5 py-2 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase";
export const TD = "px-5 py-2.5";

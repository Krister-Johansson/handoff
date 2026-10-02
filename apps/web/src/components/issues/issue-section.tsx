import { useId, type ReactNode } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** A section's count beside its heading, as on the Inbox and the Home page. */
function Count({ n }: { n: number }) {
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-secondary px-[5px] text-[11px] font-semibold tracking-normal text-secondary-foreground tabular-nums">
      {n}
    </span>
  );
}

/**
 * One card of the page's main column: a heading with its count, a link or button on the right, an
 * optional line under the heading, then its content.
 */
export function IssueSection({
  title,
  count,
  action,
  description,
  className,
  children,
}: {
  title: string;
  count?: number | undefined;
  action?: ReactNode;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("min-w-0", className)}>
      <Card className="gap-3">
        <CardHeader>
          <CardTitle id={id} className="flex items-center gap-2 text-sm font-semibold">
            {title}
            {count !== undefined && count > 0 && <Count n={count} />}
          </CardTitle>
          {description && <CardDescription className="text-[13px]">{description}</CardDescription>}
          {action && <CardAction className="text-[13px]">{action}</CardAction>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

/** One part of the right rail: a small upper-case heading, a note beside it, then its lines. */
export function RailSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2.5 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="flex items-center gap-2 text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          {title}
        </h2>
        {aside && <span className="text-[11px] font-medium tracking-[0.06em] text-muted-foreground uppercase">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** A muted line where a section has nothing to list. */
export function Quiet({ children }: { children: ReactNode }) {
  return <p className="text-[13px] text-muted-foreground">{children}</p>;
}

/** Open on GitHub, first of the header's actions. */
export function OpenOnGitHub({ url }: { url: string }) {
  return (
    <Button variant="ghost" asChild>
      <a href={url}>
        <ExternalLinkIcon data-icon="inline-start" />
        Open on GitHub
      </a>
    </Button>
  );
}

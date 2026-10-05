import { ExternalLinkIcon, MessageSquareIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { unresolvedThreads } from "@/lib/attention";

export type ReviewThreadView = { path: string; line: number | null; outdated: boolean; author: string; body: string; url: string };

/**
 * A merge that waits on unresolved review threads: each thread with a link to it on GitHub, and the pull
 * request to resolve them on. handoff resolves none itself; the merge goes on once a person has.
 */
export function ReviewThreadsCard({ number, url, threads }: { number: number; url: string; threads: ReviewThreadView[] }) {
  return (
    <Card className="ring-attention-dot/45">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareIcon className="size-4" />
          PR #{number} has {unresolvedThreads(threads.length)}
        </CardTitle>
        <CardDescription>A rule on the base branch requires resolved conversations before a merge. Resolve them on GitHub and the merge goes on.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2 text-sm">
          {threads.map((t) => (
            <li key={t.url} className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <a href={t.url} target="_blank" rel="noreferrer" className="truncate font-mono text-xs hover:underline hover:underline-offset-3">
                  {t.line !== null ? `${t.path}:${t.line}` : t.path}
                </a>
                {t.outdated && <Badge variant="outline">outdated</Badge>}
              </span>
              <span className="line-clamp-2 text-muted-foreground">{`${t.author}: ${t.body}`}</span>
            </li>
          ))}
        </ul>
        <div>
          <Button asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              Resolve on GitHub
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { RepeatIcon } from "lucide-react";
import { resolveLoopAction } from "@/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";

type Action = "retry" | "continue" | "stop";

/**
 * A run that stopped because a loop used all its attempts: no step failed, so it asks for a decision
 * instead of a repair. Another round sends the work back once more, going on takes the step's forward
 * edges as if it approved, and stopping cancels the run.
 */
export function StuckLoopCard({ runId, node, loop, attempts }: { runId: string; node: string; loop: string; attempts: number }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const decide = (action: Action) =>
    start(async () => {
      const result = await resolveLoopAction({ runId, action });
      setError(result.ok ? undefined : result.error);
    });
  return (
    <Card className="ring-attention-dot/45">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RepeatIcon className="size-4" />
          The run ran out of rounds
        </CardTitle>
        <CardDescription>
          {`${node} sent the work back ${attempts} times, as often as ${loop} allows. Decide how to go on.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={() => decide("continue")}>
            Go on as if approved
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => decide("retry")}>
            Another round
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => decide("stop")}>
            Stop the run
          </Button>
        </div>
        {error && <FieldError>{error}</FieldError>}
      </CardContent>
    </Card>
  );
}

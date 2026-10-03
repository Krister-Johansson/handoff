"use client";

import { useState, useTransition } from "react";
import { RepeatIcon } from "lucide-react";
import { resolveLoopAction } from "@/app/inbox/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldError } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

type Action = "retry" | "continue" | "stop";

/**
 * A run that stopped because a loop used all its attempts: no step failed, so it asks for a decision
 * instead of a repair. Another round sends the work back once more, going on takes the step's forward
 * edges as if it approved, and stopping cancels the run.
 */
export function StuckLoopCard({ runId, node, loop, attempts }: { runId: string; node: string; loop: string; attempts: number }) {
  const [error, setError] = useState<string>();
  // The decision sent. It stays chosen after the action succeeds, until the refreshed page drops the card.
  const [chosen, setChosen] = useState<Action>();
  const [pending, start] = useTransition();
  const decide = (action: Action) => {
    setChosen(action);
    start(async () => {
      const result = await resolveLoopAction({ runId, action });
      setError(result.ok ? undefined : result.error);
      if (!result.ok) setChosen(undefined);
    });
  };
  const busy = pending || chosen !== undefined;
  const choice = (action: Action) => ({
    type: "button" as const,
    disabled: busy,
    "aria-busy": chosen === action || undefined,
    onClick: () => decide(action),
  });
  const working = (action: Action) => chosen === action && <Spinner data-icon="inline-start" role="presentation" aria-label={undefined} aria-hidden />;
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
          <Button {...choice("continue")}>
            {working("continue")}
            Go on as if approved
          </Button>
          <Button variant="outline" {...choice("retry")}>
            {working("retry")}
            Another round
          </Button>
          <Button variant="ghost" {...choice("stop")}>
            {working("stop")}
            Stop the run
          </Button>
        </div>
        {error && <FieldError>{error}</FieldError>}
      </CardContent>
    </Card>
  );
}

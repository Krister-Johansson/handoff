"use client";

import { CopyIcon, KeyRoundIcon, LayersIcon, SearchXIcon, SquareKanbanIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SetUpPlanDialog, type PlanProjectRef } from "./set-up-plan-dialog";
import { ShapeButton } from "./shape-button";

function Command({ text }: { text: string }) {
  return (
    <div className="flex w-full items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2.5 py-1.5 text-left font-mono text-xs">{text}</code>
      <Button size="icon-sm" variant="outline" aria-label={`Copy ${text}`} onClick={() => void navigator.clipboard?.writeText(text)}>
        <CopyIcon />
      </Button>
    </div>
  );
}

export type PlanEmptyReason = "no-plan" | "no-scope" | "unreachable" | "empty";

/**
 * In place of the tree or the board when there is nothing to show: no plan yet, a token that cannot
 * reach GitHub Projects, a Project handoff cannot read, or a plan with nothing shaped in it.
 */
export function PlanEmpty({ reason, project, error }: { reason: PlanEmptyReason; project: PlanProjectRef; error?: string }) {
  return (
    <Empty className="rounded-lg border py-12">
      {reason === "no-plan" && (
        <>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SquareKanbanIcon />
            </EmptyMedia>
            <EmptyTitle>No plan on GitHub yet</EmptyTitle>
            <EmptyDescription>
              handoff can create a GitHub Project for this repository with the columns Shaping, Ready, Running, In review and Done, and the labels epic, story and task.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <SetUpPlanDialog project={project} />
          </EmptyContent>
        </>
      )}
      {reason === "no-scope" && (
        <>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KeyRoundIcon />
            </EmptyMedia>
            <EmptyTitle>GitHub Projects need the project scope</EmptyTitle>
            <EmptyDescription>
              The token in GITHUB_TOKEN cannot reach your Projects. Add the scope to the GitHub CLI login, then give the dashboard the new token and restart it.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-sm gap-2">
            <Command text="gh auth refresh -s project" />
            <span className="text-xs text-muted-foreground">then</span>
            <Command text="GITHUB_TOKEN=$(gh auth token)" />
          </EmptyContent>
        </>
      )}
      {reason === "unreachable" && (
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchXIcon />
          </EmptyMedia>
          <EmptyTitle>The plan&apos;s Project cannot be read</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      )}
      {reason === "empty" && (
        <>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing shaped yet</EmptyTitle>
            <EmptyDescription>Shape the first epic with the assistant or from Claude Code: an epic with its goal, stories with acceptance criteria, then tasks.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <ShapeButton projectName={project.name} />
          </EmptyContent>
        </>
      )}
    </Empty>
  );
}

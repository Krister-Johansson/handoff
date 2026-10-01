import type { ComponentType, ReactNode } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import type { ZodType } from "zod";
import {
  CoderOutputSchema,
  HumanAnswerSchema,
  MergeOutputSchema,
  PlannerOutputSchema,
  PrOutputSchema,
  ReviewerOutputSchema,
  TesterOutputSchema,
  type CoderOutput,
  type HumanAnswer,
  type MergeOutput,
  type PlannerOutput,
  type PrOutput,
  type ReviewerOutput,
  type TesterOutput,
} from "@handoff/core";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TerminalOutput } from "@/components/terminal-output";
import { Badge } from "@/components/ui/badge";
import { formatDuration } from "@/lib/format";

export type CheckResult = { kind: string; passed: boolean; detail?: string; logTail?: string; durationMs?: number };

export type ExecutionDetail = {
  id: string;
  nodeKey: string;
  nodeType: string;
  attempt: number;
  status: string;
  output: unknown;
  checks: CheckResult[] | null;
  error: { code: string; message: string } | null;
  trigger: { kind: string; edgeKey?: string; from?: string } | null;
  costUsd: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  repairNote: string | null;
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Log({ children }: { children: string }) {
  return <TerminalOutput text={children} />;
}

function PathList({ paths }: { paths: string[] }) {
  return (
    <ul className="flex flex-col gap-0.5 font-mono text-xs">
      {paths.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

const location = (path?: string, line?: number) => (path ? (line !== undefined ? `${path}:${line}` : path) : "");

/** Why the execution started, when neither the start node nor an edge did; the drawer's header names the edge. */
function unusualStart(trigger: ExecutionDetail["trigger"]): string | undefined {
  if (trigger?.kind === "repair") return "Started by a repair";
  if (trigger?.kind === "exhausted") return `Started because loop ${trigger.edgeKey ?? ""} ran out of rounds`;
  return undefined;
}

function PlannerView({ data: { status, question, plan, steps, ownedPaths } }: { data: PlannerOutput }) {
  if (status === "needs_input" && question)
    return (
      <Section title="Question">
        <p>{question.text}</p>
      </Section>
    );
  return (
    <>
      <Section title="Plan">
        <p className="whitespace-pre-wrap">{plan}</p>
      </Section>
      {steps.length > 0 && (
        <Section title="Steps">
          <ol className="flex list-decimal flex-col gap-1 pl-[18px]">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Section>
      )}
      {ownedPaths.length > 0 && (
        <Section title="Owned paths">
          <PathList paths={ownedPaths} />
        </Section>
      )}
    </>
  );
}

function CoderView({ data: { summary, question, filesChanged, commitSha, extraPaths } }: { data: CoderOutput }) {
  return (
    <>
      {question && (
        <Section title="Question">
          <p>{question.text}</p>
        </Section>
      )}
      {summary && (
        <Section title="Summary">
          <p className="whitespace-pre-wrap">{summary}</p>
        </Section>
      )}
      {extraPaths && extraPaths.length > 0 && (
        <Section title="Files outside the plan">
          <ul className="flex flex-col gap-1">
            {extraPaths.map((extra) => (
              <li key={extra.path} className="flex flex-col">
                <span className="font-mono text-xs">{extra.path}</span>
                <span className="text-muted-foreground">{extra.reason}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {filesChanged && filesChanged.length > 0 && (
        <Section title="Files changed">
          <PathList paths={filesChanged} />
        </Section>
      )}
      {commitSha && (
        <Section title="Commit">
          <span className="font-mono text-xs">{commitSha.slice(0, 7)}</span>
        </Section>
      )}
    </>
  );
}

function TesterView({ data: { passed, command, exitCode, tail } }: { data: TesterOutput }) {
  return (
    <Section title={passed ? "Tests passed" : "Tests failed"}>
      <div className="flex items-center gap-2 text-xs">
        <code className="font-mono">{command}</code>
        <span className="text-muted-foreground">exit {exitCode ?? "none"}</span>
      </div>
      {tail && <Log>{tail}</Log>}
    </Section>
  );
}

function ReviewerView({ data: { verdict, comments } }: { data: ReviewerOutput }) {
  return (
    <Section title="Review">
      <Badge variant={verdict === "approve" ? "secondary" : "destructive"} className="w-fit">
        {verdict === "approve" ? "Approved" : "Changes requested"}
      </Badge>
      <ul className="flex flex-col gap-2">
        {comments.map((c) => (
          <li key={`${location(c.path, c.line)} ${c.body}`} className="flex flex-col gap-0.5">
            <span className="font-mono text-xs text-muted-foreground">{location(c.path, c.line)}</span>
            <p className="whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const CI_LABEL = { success: "CI passing", failure: "CI failing", pending: "CI pending" } as const;

function PrView({ data: { prNumber, prUrl, feedback } }: { data: PrOutput }) {
  return (
    <>
      <Section title="Pull request">
        <div className="flex items-center gap-2">
          <a className="font-medium hover:underline" href={prUrl}>
            #{prNumber}
          </a>
          <Badge variant={feedback.ci.status === "failure" ? "destructive" : "secondary"}>{CI_LABEL[feedback.ci.status]}</Badge>
          {feedback.review.decision !== "none" && <Badge variant="outline">review: {feedback.review.decision.replace("_", " ")}</Badge>}
        </div>
      </Section>
      {feedback.ci.failedJobs.map((job) => (
        <Section key={job.jobId} title={`Failed job: ${job.name}`}>
          <a className="text-xs hover:underline" href={job.url}>
            Open the job log
          </a>
          {job.logExcerpt && <Log>{job.logExcerpt}</Log>}
        </Section>
      ))}
      {feedback.review.comments.length > 0 && (
        <Section title="Review comments">
          <ul className="flex flex-col gap-2">
            {feedback.review.comments.map((c) => (
              <li key={c.url + c.body} className="flex flex-col gap-0.5">
                <span className="font-mono text-xs text-muted-foreground">
                  {c.author}
                  {c.path ? ` on ${location(c.path, c.line)}` : ""}
                  {c.resolved ? " (resolved)" : ""}
                </span>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function AnswerView({ data }: { data: HumanAnswer }) {
  return (
    <Section title={`Answer from ${data.answeredBy}`}>
      {data.option && <Badge variant="outline">{data.option}</Badge>}
      <p className="whitespace-pre-wrap">{data.answer}</p>
    </Section>
  );
}

function MergeView({ data }: { data: MergeOutput }) {
  return (
    <Section title="Merge">
      <p>
        {data.merged ? "Merged" : "Not merged"}
        {data.sha && <span className="ml-2 font-mono text-xs">{data.sha.slice(0, 7)}</span>}
      </p>
    </Section>
  );
}

type ViewEntry = { schema: ZodType<unknown>; View: ComponentType<{ data: unknown }> };
const entry = <T,>(schema: ZodType<T>, View: ComponentType<{ data: T }>) => ({ schema, View }) as ViewEntry;

/** Tried in order; the first output contract that parses renders. */
const VIEWS = [
  entry(PlannerOutputSchema, PlannerView),
  entry(CoderOutputSchema, CoderView),
  entry(TesterOutputSchema, TesterView),
  entry(ReviewerOutputSchema, ReviewerView),
  entry(PrOutputSchema, PrView),
  entry(HumanAnswerSchema, AnswerView),
  entry(MergeOutputSchema, MergeView),
];

/** What the node produced, rendered by output contract; anything unrecognised is shown as JSON. */
function Output({ output }: { output: unknown }) {
  for (const { schema, View } of VIEWS) {
    const parsed = schema.safeParse(output);
    if (parsed.success) return <View data={parsed.data} />;
  }
  return (
    <Section title="Output">
      <Log>{JSON.stringify(output, null, 2)}</Log>
    </Section>
  );
}

function Checks({ checks }: { checks: CheckResult[] }) {
  return (
    <Section title="Checks">
      <ul className="flex flex-col">
        {checks.map((c) => (
          <li key={`${c.kind} ${c.detail ?? ""}`} className="flex flex-col gap-1 py-1">
            <div className="flex items-center gap-2 text-xs">
              {c.passed ? <CheckIcon aria-label="passed" className="size-3.5 shrink-0 text-success" /> : <XIcon aria-label="failed" className="size-3.5 shrink-0 text-danger" />}
              <span className="font-mono">{c.kind}</span>
              {c.detail && <span className="text-muted-foreground">{c.detail}</span>}
              {c.durationMs !== undefined && <span className="ml-auto text-muted-foreground tabular-nums">{formatDuration(c.durationMs)}</span>}
            </div>
            {!c.passed && c.logTail && <Log>{c.logTail}</Log>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** What one execution produced and the checks the engine ran on it; its status, time and cost head the drawer. */
export function ExecutionDetails({ detail }: { detail: ExecutionDetail }) {
  const started = unusualStart(detail.trigger);
  return (
    <div className="flex flex-col gap-5 text-[13px]">
      {started && <p className="text-xs text-muted-foreground">{started}</p>}
      {detail.repairNote && (
        <Section title="Repair note">
          <p className="whitespace-pre-wrap">{detail.repairNote}</p>
        </Section>
      )}
      {detail.error && (
        <Alert variant="destructive">
          <AlertTitle>{detail.error.code}</AlertTitle>
          <AlertDescription>{detail.error.message}</AlertDescription>
        </Alert>
      )}
      {detail.output !== null && detail.output !== undefined && <Output output={detail.output} />}
      {detail.checks && detail.checks.length > 0 && <Checks checks={detail.checks} />}
    </div>
  );
}

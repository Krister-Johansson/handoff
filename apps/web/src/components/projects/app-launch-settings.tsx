"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  AppWindowIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  InfoIcon,
  PlayIcon,
  PlusIcon,
  RotateCwIcon,
  SquareIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { commandLine, configurationFromForm, formFromConfiguration, launchFileText, type LaunchForm, type LaunchFormField } from "@handoff/core";
import type { LaunchTestStep } from "@handoff/db";
import { launchTestAction, saveAppLaunchAction, startLaunchTestAction, stopLaunchTestAction, type AppLaunchRefusal } from "@/app/projects/launch-actions";
import { CARD_BODY, SectionCard } from "@/components/section-card";
import { Tag } from "@/components/tag";
import { TerminalOutput } from "@/components/terminal-output";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { dockerLaunchNote, engineWarning, LAUNCH_DOCS_URL } from "@/lib/app-launch";
import { PROJECTS_SETTINGS_PATH } from "@/lib/paths";
import { cn } from "@/lib/utils";
import type { AppLaunchView, LaunchTestView } from "@/server/app-launch";

const LINK = "font-medium text-foreground underline underline-offset-3";
const LABEL = "text-[11px] font-medium tracking-[0.05em] text-muted-foreground uppercase";
const CODE = "rounded-[5px] border bg-muted px-1.5 py-px font-mono text-[12.5px]";

const EMPTY_FORM: LaunchForm = { command: "", cwd: "", port: "3000", anyPort: true, url: "", env: [] };
type Errors = Partial<Record<LaunchFormField, string>> & { form?: string };

/** Text with `code` spans in backticks, as the Test start steps write commands. */
function Detail({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code key={`${i}-${part}`} className={CODE}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** One label and value of the read-only configuration; they stack under 640 px. */
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[166px_minmax(0,1fr)] sm:items-baseline sm:gap-3">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-[13px]">{children}</dd>
    </div>
  );
}

/** What handoff starts from the repository's launch file, read-only. */
function Detected({ detected, branch, savedToo }: { detected: Extract<AppLaunchView["detected"], { kind: "file" }>; branch: string; savedToo: boolean }) {
  const config = detected.picked;
  const env = Object.entries(config.env);
  return (
    <div className={cn(CARD_BODY, "flex flex-col gap-5")}>
      <div className="flex items-start gap-3 rounded-lg border bg-muted/60 px-4 py-3">
        <FileCodeIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">Detected from .claude/launch.json</p>
          <p className="text-[13px] text-muted-foreground">
            On {branch}. The file wins over this page: edit it in the repository to change how the app starts.
            {savedToo && " The setting saved here stays stored but is not used while the file is there."}
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <a href={detected.url} target="_blank" rel="noreferrer">
            <ExternalLinkIcon data-icon="inline-start" />
            View file
          </a>
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        <span className={LABEL}>Configuration</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {detected.configurations.map((name) => (
            <Tag key={name} mono tone={name === config.name ? "success" : "outline"} {...(name === config.name ? { "data-picked": "" } : {})}>
              {name === config.name && <CheckIcon aria-hidden />}
              {name}
            </Tag>
          ))}
          <span className="text-xs text-muted-foreground">Handoff starts the one named handoff-demo, else the first.</span>
        </div>
      </div>
      <dl className="flex flex-col gap-2.5">
        <Pair label="Command">
          <code className={CODE}>{commandLine(config)}</code>
        </Pair>
        <Pair label="Working directory">{config.cwd ? <code className={CODE}>{config.cwd}</code> : "Repository root"}</Pair>
        <Pair label="Port">
          {config.autoPort === false ? (
            `Port ${config.port} only`
          ) : (
            <>
              Any free port, passed in PORT <span className="text-muted-foreground">{config.port} in the file</span>
            </>
          )}
        </Pair>
        <Pair label="Opens at">
          <code className={CODE}>{config.url ?? "http://localhost:<port>"}</code>
        </Pair>
        <Pair label="Environment">
          {env.length === 0 ? (
            "None"
          ) : (
            <span className="flex flex-wrap gap-1.5">
              {env.map(([name, value]) => (
                <code key={name} className={CODE}>
                  {name}={value}
                </code>
              ))}
            </span>
          )}
        </Pair>
      </dl>
    </div>
  );
}

/** The steps that run before the app, read-only, in the order handoff runs them. */
function BeforeStart({ view }: { view: AppLaunchView }) {
  const id = useId();
  const services = view.services;
  const steps: { title: string; value: ReactNode; note?: ReactNode }[] = [
    {
      title: "Services",
      value:
        services === undefined ? (
          `Handoff cannot read the repository's compose file on ${view.branch} without GitHub.`
        ) : services === null ? (
          "None"
        ) : (
          <>
            <code className={CODE}>{services.file}</code>
            {services.names.length > 0 && `: ${services.names.join(", ")}`}
          </>
        ),
      note: "Start once for the project and stay up, shared by every run.",
    },
    {
      title: "Seed command",
      value: view.seedCommand ? <code className={CODE}>{view.seedCommand}</code> : "None",
      note: (
        <>
          Set in{" "}
          <Link href={PROJECTS_SETTINGS_PATH} className="underline underline-offset-3">
            Settings, Projects
          </Link>
          .
        </>
      ),
    },
    {
      title: "App",
      value: "The command above, on its port",
      note: view.docker ? "Runs in its own container and stops when its step ends." : "Runs in its own process group with a minimal environment. It stops when its step ends.",
    },
    { title: "Ready check", value: view.docker ? "Ready when the app answers on its port, within 2 minutes" : "Ready when the app accepts connections on its port, within 2 minutes" },
  ];
  return (
    <div className={cn(CARD_BODY, "flex flex-col gap-2")}>
      <span id={id} className={LABEL}>
        Before the app starts
      </span>
      <ol aria-labelledby={id} className="flex flex-col divide-y rounded-lg border">
        {steps.map((step, i) => (
          <li key={step.title} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[22px_118px_minmax(0,1fr)]">
            <span className="flex size-[22px] items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground">
              {i + 1}
            </span>
            <span className="text-[13px] font-medium">{step.title}</span>
            <div className="col-start-2 text-[13px] sm:col-start-3">
              <div>{step.value}</div>
              {step.note && <div className="text-xs text-muted-foreground">{step.note}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const STEP_LABEL: Record<LaunchTestStep["name"], string> = { worktree: "Worktree", setup: "Setup", services: "Services", seed: "Seed", app: "App" };

/** A step's time: tenths of a second under a minute, minutes and seconds over it. */
function duration(ms: number) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function StepIcon({ status }: { status: LaunchTestStep["status"] }) {
  if (status === "running") return <Spinner aria-hidden role="presentation" className="size-3.5 text-muted-foreground" />;
  if (status === "failed") return <CircleXIcon aria-hidden className="size-3.5 text-danger" />;
  return <CircleCheckIcon aria-hidden className="size-3.5 text-success" />;
}

/** How a Test start's header looks in each state: its icon and its tint. */
const RESULT_LOOK: Record<LaunchTestView["status"], { icon: ReactNode; tint?: string }> = {
  starting: { icon: <Spinner aria-hidden role="presentation" className="text-muted-foreground" /> },
  ready: { icon: <CircleCheckIcon aria-hidden className="size-4 text-success" />, tint: "border-success/30 [&>header]:bg-success-bg" },
  failed: { icon: <CircleXIcon aria-hidden className="size-4 text-danger" />, tint: "border-danger/30 [&>header]:bg-danger-bg" },
  stopped: { icon: <SquareIcon aria-hidden className="size-4 text-muted-foreground" /> },
};

function resultTitle(test: LaunchTestView) {
  if (test.status === "starting") return "Starting the app";
  if (test.status === "failed") return "The app did not start";
  if (test.status === "stopped") return "Stopped";
  return `Ready in ${((Date.parse(test.readyAt ?? test.createdAt) - Date.parse(test.createdAt)) / 1000).toFixed(1)} s`;
}

/** What a person can do with a Test start: open the app and stop it, or try again after a failure. */
function ResultActions({ test, onStop, onRetry, busy }: { test: LaunchTestView; onStop: () => void; onRetry: () => void; busy: boolean }) {
  if (test.status === "failed") {
    return (
      <Button type="button" size="sm" variant="outline" onClick={onRetry} disabled={busy}>
        <RotateCwIcon data-icon="inline-start" />
        Try again
      </Button>
    );
  }
  if (test.status === "stopped") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {test.status === "ready" && test.url && (
        <Button asChild size="sm">
          <a href={test.url} target="_blank" rel="noreferrer">
            <ExternalLinkIcon data-icon="inline-start" />
            Open the app
            <span className="font-mono text-[11px] opacity-70">{new URL(test.url).host}</span>
          </a>
        </Button>
      )}
      <Button type="button" size="sm" variant="outline" onClick={onStop} disabled={busy}>
        <SquareIcon data-icon="inline-start" />
        Stop
      </Button>
    </div>
  );
}

/** Each step of a Test start with what it did and its time. */
function StepList({ steps }: { steps: LaunchTestStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="flex flex-col divide-y border-t">
      {steps.map((step) => (
        <li key={step.name} className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 px-4 py-2 sm:grid-cols-[16px_86px_minmax(0,1fr)_auto]">
          <span className="self-center">
            <StepIcon status={step.status} />
          </span>
          <span className="text-[13px] font-medium">{STEP_LABEL[step.name]}</span>
          <span className="col-start-2 row-start-2 text-[13px] text-muted-foreground sm:col-start-3 sm:row-start-1">
            <Detail text={step.detail} />
          </span>
          <span className="col-start-3 row-start-1 text-right text-xs text-muted-foreground tabular-nums sm:col-start-4">{step.ms === null ? "" : duration(step.ms)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A ready app's server log, folded, and when the Test start stops it. */
function ReadyFooter({ log, stopsAt, now }: { log: string; stopsAt: string; now: number }) {
  const minutes = Math.max(1, Math.ceil((Date.parse(stopsAt) - now) / 60_000));
  return (
    <Collapsible className="border-t">
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="xs" className="group/log -ml-2 text-muted-foreground">
            <ChevronRightIcon data-icon="inline-start" className="transition-transform group-data-[state=open]/log:rotate-90" />
            Server log
          </Button>
        </CollapsibleTrigger>
        <span className="text-xs text-muted-foreground">
          Stops by itself in {minutes} {minutes === 1 ? "minute" : "minutes"}
        </span>
      </div>
      <CollapsibleContent className="px-4 pb-3">
        <TerminalOutput text={log || "No output yet."} label="server log" />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Why a Test start failed, and the end of the output that says so. */
function Failure({ error, log }: { error: string | null; log: string }) {
  if (!error && !log) return null;
  return (
    <div className="flex flex-col gap-2 border-t px-4 py-3">
      {error && <p className="text-[13px]">{error}</p>}
      {log && <TerminalOutput text={log} label="server log" />}
    </div>
  );
}

/** A Test start: where it is, each step with its time, and the app or why it did not start. */
function TestResult({ test, now, onStop, onRetry, busy }: { test: LaunchTestView; now: number; onStop: () => void; onRetry: () => void; busy: boolean }) {
  const id = useId();
  const look = RESULT_LOOK[test.status];
  return (
    <div role="status" aria-labelledby={id} className={cn("overflow-hidden rounded-lg border", look.tint)}>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        {look.icon}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            <span className="sr-only" id={id}>
              Test start
            </span>
            {resultTitle(test)}
          </p>
          <p className="text-xs break-words text-muted-foreground">
            Test start{test.command && `, ${test.command}`}
            {test.port && ` on port ${test.port}`}
          </p>
        </div>
        <ResultActions test={test} onStop={onStop} onRetry={onRetry} busy={busy} />
      </header>
      <StepList steps={test.steps} />
      {test.status === "failed" && <Failure error={test.error} log={test.log} />}
      {test.status === "ready" && <ReadyFooter log={test.log} stopsAt={test.stopsAt} now={now} />}
    </div>
  );
}

type Row = { key: number; name: string; value: string };

const OPTIONAL = <span className="ml-1 font-normal text-muted-foreground">Optional</span>;

/** One field of the form: its label, its control, what it means and what to fix. */
function FormField({ id, label, optional, error, description, children }: { id?: string; label: string; optional?: boolean; error?: string; description: string; children: ReactNode }) {
  const name = (
    <>
      {label}
      {optional && OPTIONAL}
    </>
  );
  return (
    <Field data-invalid={error ? true : undefined}>
      {id ? <FieldLabel htmlFor={id}>{name}</FieldLabel> : <span className="text-sm font-medium">{name}</span>}
      {children}
      <FieldDescription className="text-xs">{description}</FieldDescription>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  );
}

/** A one-line text field in monospace, marked invalid when it has an error. */
function TextInput({ id, value, onChange, placeholder, error }: { id: string; value: string; onChange: (value: string) => void; placeholder: string; error?: string }) {
  return <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="font-mono" aria-invalid={error ? true : undefined} />;
}

/** The environment variables as rows of a name and a value. */
function EnvRows({ rows, setRows, nextKey, invalid }: { rows: Row[]; setRows: (rows: Row[]) => void; nextKey: () => number; invalid: boolean }) {
  const change = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <>
      {rows.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
          <span className="text-xs text-muted-foreground">Name</span>
          <span className="col-span-2 text-xs text-muted-foreground">Value</span>
          {rows.map((row, i) => (
            <div key={row.key} className="contents">
              <Input aria-label={`Variable ${i + 1} name`} value={row.name} onChange={(e) => change(row.key, { name: e.target.value })} className="font-mono" aria-invalid={invalid || undefined} />
              <Input aria-label={`Variable ${i + 1} value`} value={row.value} onChange={(e) => change(row.key, { value: e.target.value })} className="font-mono" />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${row.name.trim() || `variable ${i + 1}`}`} onClick={() => setRows(rows.filter((r) => r.key !== row.key))}>
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      )}
      <div>
        <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={() => setRows([...rows, { key: nextKey(), name: "", value: "" }])}>
          <PlusIcon data-icon="inline-start" />
          Add variable
        </Button>
      </div>
    </>
  );
}

/** The App launch form: one configuration of a launch file, the command on one line. */
function LaunchFields({ form, rows, errors, set, setRows, nextKey }: { form: LaunchForm; rows: Row[]; errors: Errors; set: (patch: Partial<LaunchForm>) => void; setRows: (rows: Row[]) => void; nextKey: () => number }) {
  const id = useId();
  const port = form.port || "its port";
  const portHelp = form.anyPort
    ? `Handoff picks a free port and passes it in PORT, so runs side by side do not clash. Turn this off when the app can only listen on ${port}.`
    : `The app always listens on ${port}, so only one run's app can start at a time.`;
  return (
    <FieldGroup className={cn(CARD_BODY, "gap-5")}>
      <FormField id={`${id}-command`} label="Command" error={errors.command} description="Runs in the run's worktree. Handoff splits it into the program and its arguments; for a pipe or &&, start with sh -c.">
        <TextInput id={`${id}-command`} value={form.command} onChange={(command) => set({ command })} placeholder="pnpm dev" error={errors.command} />
      </FormField>
      <FormField id={`${id}-cwd`} label="Working directory" optional error={errors.cwd} description="Relative to the repository root, and inside it. Empty means the root.">
        <TextInput id={`${id}-cwd`} value={form.cwd} onChange={(cwd) => set({ cwd })} placeholder="apps/web" error={errors.cwd} />
      </FormField>
      <FormField id={`${id}-port`} label="Port" error={errors.port} description={portHelp}>
        <div className="flex flex-wrap items-center gap-4">
          <Input id={`${id}-port`} type="number" min={1} max={65535} value={form.port} onChange={(e) => set({ port: e.target.value })} className="w-28 font-mono" aria-invalid={errors.port ? true : undefined} />
          <div className="flex items-center gap-2">
            <Switch id={`${id}-any`} checked={form.anyPort} onCheckedChange={(anyPort) => set({ anyPort })} />
            <label htmlFor={`${id}-any`} className="text-[13px] font-medium">
              Any free port
            </label>
          </div>
        </div>
      </FormField>
      <FormField id={`${id}-url`} label="Opens at" optional error={errors.url} description="The address Try it opens. Handoff puts the run's port in it.">
        <TextInput id={`${id}-url`} value={form.url} onChange={(url) => set({ url })} placeholder="http://localhost:3000" error={errors.url} />
      </FormField>
      <FormField label="Environment" optional error={errors.env} description="Stored as plain text. Do not put secrets here.">
        <EnvRows rows={rows} setRows={setRows} nextKey={nextKey} invalid={Boolean(errors.env)} />
      </FormField>
    </FieldGroup>
  );
}

/** Follows a Test start while it starts and runs: every second while starting, every five while ready. */
function useFollowedTest(projectId: string, initial: LaunchTestView | null) {
  const [test, setTest] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const status = test?.status;
  useEffect(() => {
    if (status !== "starting" && status !== "ready") return;
    let live = true;
    const timer = setInterval(
      () => {
        void launchTestAction({ projectId }).then((next) => {
          if (!live) return;
          setNow(Date.now());
          if (next) setTest(next);
        });
      },
      status === "starting" ? 1000 : 5000,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [projectId, status]);
  return { test, setTest, now };
}

/** The form's values and its environment rows, filled from the saved setting. */
function useLaunchForm(saved: AppLaunchView["saved"]) {
  const [form, setForm] = useState<LaunchForm>(() => (saved ? formFromConfiguration(saved) : EMPTY_FORM));
  // Each environment row keeps its key while rows above it are removed; the saved rows take 1 to n.
  const [rows, setRows] = useState<Row[]>(() => form.env.map((r, i) => ({ key: i + 1, ...r })));
  const keys = useRef(rows.length);
  return {
    form,
    rows,
    setRows,
    nextKey: () => ++keys.current,
    set: (patch: Partial<LaunchForm>) => setForm((f) => ({ ...f, ...patch })),
    current: (): LaunchForm => ({ ...form, env: rows.map(({ name, value }) => ({ name, value })) }),
  };
}

/** The refusal of an action as the form shows it. */
const errorsOf = (refusal: AppLaunchRefusal): Errors => ({ ...refusal.errors, ...(refusal.error ? { form: refusal.error } : {}) });

/** The tag beside the section's title: where the configuration comes from. */
function SourceTag({ view }: { view: AppLaunchView }) {
  if (view.detected.kind === "file") {
    return (
      <Tag tone="success">
        <FileCodeIcon aria-hidden />
        From .claude/launch.json
      </Tag>
    );
  }
  return view.saved ? <Tag>Set here</Tag> : null;
}

/** Without GitHub, handoff cannot tell whether the repository has a launch file. */
function UnknownNote({ view }: { view: AppLaunchView }) {
  if (view.detected.kind !== "unknown") return null;
  return (
    <p className={cn(CARD_BODY, "flex items-start gap-2 text-xs text-muted-foreground")}>
      <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
      GitHub is not connected, so handoff cannot check {view.branch} for .claude/launch.json. A file there wins over this setting.
    </p>
  );
}

/** In Docker workspace mode: where the app runs and how it must listen, and the warning for a Docker Engine before 28. */
function DockerNote({ view }: { view: AppLaunchView }) {
  if (!view.docker) return null;
  const warning = engineWarning(view.docker.engine);
  return (
    <div className={cn(CARD_BODY, "flex flex-col gap-3")}>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
        {dockerLaunchNote(view.docker, view.services?.file)}
      </p>
      {warning && (
        <Alert className="border-attention-dot/35 bg-attention-bg">
          <TriangleAlertIcon className="text-attention" />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/** A launch file handoff cannot read: runs stop there too, so the section says why. */
function InvalidFile({ detected, branch }: { detected: Extract<AppLaunchView["detected"], { kind: "invalid" }>; branch: string }) {
  return (
    <div className={cn(CARD_BODY, "flex flex-col gap-3")}>
      <Alert variant="destructive">
        <FileCodeIcon />
        <AlertDescription>
          <p>
            The .claude/launch.json on {branch} cannot be read, so Try it and demo steps stop there: {detected.error}
          </p>
          <a href={detected.url} target="_blank" rel="noreferrer" className={LINK}>
            View file
          </a>
        </AlertDescription>
      </Alert>
    </div>
  );
}

/** Neither a launch file nor a setting: what fails today, and the two ways to fix it. */
function NotSetUp({ view, onSetUp }: { view: AppLaunchView; onSetUp: () => void }) {
  return (
    <>
      <Empty className="py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AppWindowIcon />
          </EmptyMedia>
          <EmptyTitle>Handoff does not know how to start this app</EmptyTitle>
          <EmptyDescription>
            {view.projectName} has no .claude/launch.json on {view.branch}. Set the command here, or add the file to the repository as Claude Code desktop describes.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          <Button type="button" size="sm" onClick={onSetUp}>
            <PlusIcon data-icon="inline-start" />
            Set up here
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={LAUNCH_DOCS_URL} target="_blank" rel="noreferrer">
              <ExternalLinkIcon data-icon="inline-start" />
              About launch.json
            </a>
          </Button>
        </EmptyContent>
        <p className="flex max-w-lg items-start gap-2 rounded-md border border-dashed px-3 py-2 text-left text-xs text-muted-foreground">
          <InfoIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span>
            Until then, Try it and demo steps in this project stop with &quot;This repository has no .claude/launch.json and the project has no App launch setting, so handoff does not
            know how to start the app.&quot;
          </span>
        </p>
      </Empty>
      <UnknownNote view={view} />
    </>
  );
}

/** The footer under a configuration: its buttons, what went wrong, and the Test start. */
function Footer({ children, error, result }: { children: ReactNode; error?: string; result: ReactNode }) {
  return (
    <div className={cn(CARD_BODY, "flex flex-col gap-3 border-t pt-4")}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {error && <FieldError>{error}</FieldError>}
      {result}
    </div>
  );
}

function TestStartButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={busy}>
      <PlayIcon data-icon="inline-start" />
      Test start
    </Button>
  );
}

/** Copies the form as a launch file to commit, once the form is one handoff can start. */
function CopyButton({ current, setErrors }: { current: () => LaunchForm; setErrors: (errors: Errors) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const result = configurationFromForm(current());
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    try {
      await navigator.clipboard.writeText(launchFileText(result.configuration));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setErrors({ form: "The browser did not allow copying. Copy the values from the form instead." });
    }
  };
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      {copied ? "Copied" : "Copy as launch.json"}
    </Button>
  );
}

/**
 * Project settings' App launch: how handoff starts a run's app for Try it and demo steps. A repository
 * with .claude/launch.json shows it read-only, since the file wins. Without one the form holds the same
 * values as one configuration of that file; Test start runs it from a fresh worktree of the default
 * branch, saved or not, and Copy as launch.json gives the file to commit. The page keys the section on
 * the saved setting, so a save shows it again.
 */
export function AppLaunchSettings({ view }: { view: AppLaunchView }) {
  const { projectId, detected } = view;
  const [editing, setEditing] = useState(view.saved !== null);
  const launch = useLaunchForm(view.saved);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, startBusy] = useTransition();
  const { test, setTest, now } = useFollowedTest(projectId, view.test);

  const save = (e: FormEvent) => {
    e.preventDefault();
    startBusy(async () => {
      const result = await saveAppLaunchAction({ projectId, form: launch.current() });
      setErrors(result.ok ? {} : errorsOf(result));
    });
  };
  const testStart = (withForm: boolean) =>
    startBusy(async () => {
      const result = await startLaunchTestAction(withForm ? { projectId, form: launch.current() } : { projectId });
      setErrors(result.ok ? {} : errorsOf(result));
      if (result.ok) setTest(result.test);
    });
  const stop = () =>
    startBusy(async () => {
      const next = test && (await stopLaunchTestAction({ projectId, id: test.id }));
      if (next) setTest(next);
    });

  const fromFile = detected.kind === "file";
  const result = test && <TestResult test={test} now={now} onStop={stop} onRetry={() => testStart(!fromFile)} busy={busy} />;

  let body: ReactNode;
  if (detected.kind === "file") {
    body = (
      <>
        <Detected detected={detected} branch={view.branch} savedToo={view.saved !== null} />
        <BeforeStart view={view} />
        <Footer error={errors.form} result={result}>
          <TestStartButton onClick={() => testStart(false)} busy={busy} />
          <span className="text-xs text-muted-foreground">Starts the app from a fresh worktree of {view.branch}, then stops it.</span>
        </Footer>
      </>
    );
  } else if (detected.kind === "invalid") {
    body = <InvalidFile detected={detected} branch={view.branch} />;
  } else if (!editing) {
    body = <NotSetUp view={view} onSetUp={() => setEditing(true)} />;
  } else {
    body = (
      <form onSubmit={save} noValidate>
        <UnknownNote view={view} />
        <LaunchFields form={launch.form} rows={launch.rows} errors={errors} set={launch.set} setRows={launch.setRows} nextKey={launch.nextKey} />
        <BeforeStart view={view} />
        <Footer error={errors.form} result={result}>
          <Button type="submit" size="sm" disabled={busy}>
            Save
          </Button>
          <TestStartButton onClick={() => testStart(true)} busy={busy} />
          <CopyButton current={launch.current} setErrors={setErrors} />
          <span className="ml-auto text-xs text-muted-foreground">Test start uses the form as it is, saved or not.</span>
        </Footer>
      </form>
    );
  }

  return (
    <section aria-label="App launch">
      <SectionCard title="App launch" description="How handoff starts a run's app from its worktree, for Try it and for screenshots." action={<SourceTag view={view} />}>
        <DockerNote view={view} />
        {body}
      </SectionCard>
    </section>
  );
}

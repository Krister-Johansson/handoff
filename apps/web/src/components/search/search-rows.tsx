import type { ReactNode } from "react";
import {
  AudioLinesIcon,
  BellIcon,
  BookOpenIcon,
  BotIcon,
  BoxesIcon,
  CalendarClockIcon,
  CircleDotIcon,
  CpuIcon,
  FolderGit2Icon,
  GitForkIcon,
  GitPullRequestIcon,
  HomeIcon,
  InboxIcon,
  LibraryIcon,
  ListTreeIcon,
  MessageSquareIcon,
  MessagesSquareIcon,
  PinIcon,
  PlayIcon,
  PlugIcon,
  RulerIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SunMoonIcon,
  TerminalIcon,
  WaypointsIcon,
  type LucideIcon,
} from "lucide-react";
import { ProjectTile } from "@/components/assistant/chat-bits";
import { KindBadge, StatusPill } from "@/components/plan/plan-status";
import { StatusBadge } from "@/components/runs/status-badge";
import { formatAgoShort } from "@/lib/format";
import type { PageIcon, SearchPage } from "@/lib/search/pages";
import type { SearchHit, SearchItem, SearchMatch } from "@/lib/search/results";
import type { SearchChat, SearchProject, SearchRun, SearchTask } from "@/lib/search/types";
import { cn } from "@/lib/utils";

const PAGE_ICON: Record<PageIcon, LucideIcon> = {
  home: HomeIcon,
  runs: PlayIcon,
  plan: ListTreeIcon,
  issues: CircleDotIcon,
  pulls: GitPullRequestIcon,
  "project-settings": SlidersHorizontalIcon,
  graphs: GitForkIcon,
  library: LibraryIcon,
  mode: WaypointsIcon,
  scheduler: CalendarClockIcon,
  estimates: RulerIcon,
  inbox: InboxIcon,
  chats: MessagesSquareIcon,
  notifications: BellIcon,
  settings: SettingsIcon,
  projects: FolderGit2Icon,
  skills: BookOpenIcon,
  subagents: BotIcon,
  mcp: PlugIcon,
  groups: BoxesIcon,
  appearance: SunMoonIcon,
  voice: AudioLinesIcon,
  agents: TerminalIcon,
  assistant: MessageSquareIcon,
  worker: CpuIcon,
  project: FolderGit2Icon,
};

const KIND_LABEL = { epic: "Epic", story: "Story", task: "Task" } as const;
const NO_MATCH: SearchMatch = { title: null, number: 0 };

/** What a row needs to know beyond its result: the projects by id, which one search covers, and whether it covers them all. */
export type RowContext = { projects: Map<string, SearchProject>; currentId: string | null; all: boolean };

/** A title with the matched part in bold. */
function Marked({ text, range }: { text: string; range: [number, number] | null }) {
  if (!range) return text;
  const [start, end] = range;
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-transparent font-semibold text-inherit">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/** A task's number or a run's short id in mono, its matched leading digits bold. */
function Mono({ prefix = "", text, matched = 0 }: { prefix?: string; text: string; matched?: number }) {
  return (
    <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
      {prefix}
      {matched > 0 && <mark className="bg-transparent font-semibold text-foreground">{text.slice(0, matched)}</mark>}
      {text.slice(matched)}
    </span>
  );
}

/** The parts of a result row: the icon, the title line, the line under it and what sits on the right. */
export function RowBody({ icon, line, sub, right }: { icon: ReactNode; line: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <>
      <span aria-hidden className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-[15px]!">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-[7px]">{line}</span>
        {sub && <span className="truncate text-[11.5px] text-muted-foreground">{sub}</span>}
      </span>
      {right && <span className="flex shrink-0 items-center gap-2">{right}</span>}
    </>
  );
}

const Title = ({ children }: { children: ReactNode }) => <span className="min-w-0 truncate text-foreground">{children}</span>;
const Age = ({ at }: { at: string | null }) =>
  at ? <span className="min-w-[22px] text-right text-[11.5px] whitespace-nowrap text-muted-foreground tabular-nums max-md:hidden">{formatAgoShort(new Date(at))}</span> : null;


const isGroup = (kind: string | undefined): kind is "story" | "epic" => kind === "story" || kind === "epic";
const joined = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(" · ") || undefined;

/** The project a result belongs to when it is not the one search covers, or when search covers them all; it names its project and shows its tile. */
function elsewhere(ctx: RowContext, id: string | null) {
  const project = id ? ctx.projects.get(id) : undefined;
  return project && (ctx.all || id !== ctx.currentId) ? project : undefined;
}

function Tile({ ctx, id }: { ctx: RowContext; id: string | null }) {
  const project = elsewhere(ctx, id);
  return project ? <ProjectTile project={{ id: project.id, name: project.name }} /> : null;
}

/** A task: number, title and kind, its project and parent (or the run it came from), its status. */
function TaskRow({ task, match, ctx }: { task: SearchTask; match: SearchMatch; ctx: RowContext }) {
  const parent = task.parent && `${task.parent.kind ? `${KIND_LABEL[task.parent.kind]} ` : ""}#${task.parent.number} · ${task.parent.title}`;
  const other = elsewhere(ctx, task.projectId);
  return (
    <RowBody
      icon={isGroup(task.kind) ? <ListTreeIcon /> : <CircleDotIcon />}
      line={
        <>
          <Mono prefix="#" text={String(task.number)} matched={match.number} />
          <Title>
            <Marked text={task.title} range={match.title} />
          </Title>
          {isGroup(task.kind) && <KindBadge kind={task.kind} />}
        </>
      }
      sub={joined(other?.name, parent, task.fromRun && `From run ${task.fromRun}`)}
      right={
        (task.status || other) && (
          <>
            {task.status && <StatusPill column={task.status} />}
            <Tile ctx={ctx} id={task.projectId} />
          </>
        )
      }
    />
  );
}

/** A run: short id and title, its project, issues and branch, its status and age. */
function RunRow({ run, match, ctx }: { run: SearchRun; match: SearchMatch; ctx: RowContext }) {
  return (
    <RowBody
      icon={<PlayIcon />}
      line={
        <>
          <Mono text={run.shortId} />
          <Title>
            <Marked text={run.title} range={match.title} />
          </Title>
        </>
      }
      sub={joined(elsewhere(ctx, run.projectId)?.name, run.issues.map((n) => `#${n}`).join(", "), run.branch)}
      right={
        <>
          <StatusBadge status={run.status} />
          <Tile ctx={ctx} id={run.projectId} />
          <Age at={run.at} />
        </>
      }
    />
  );
}

/** A page: its name and where it sits. */
function PageRow({ page, match }: { page: SearchPage; match: SearchMatch }) {
  const Icon = PAGE_ICON[page.icon];
  return (
    <RowBody
      icon={<Icon />}
      line={
        <Title>
          <Marked text={page.label} range={match.title} />
        </Title>
      }
      sub={page.trail}
    />
  );
}

/** A chat: its project's tile and its title, the project when it is another, a pin and its age. */
function ChatRow({ chat, match, ctx }: { chat: SearchChat; match: SearchMatch; ctx: RowContext }) {
  const project = chat.projectId ? ctx.projects.get(chat.projectId) : undefined;
  return (
    <RowBody
      icon={<ProjectTile project={project ? { id: project.id, name: project.name } : null} className="size-[18px] text-[10px]" />}
      line={
        <Title>
          <Marked text={chat.title} range={match.title} />
        </Title>
      }
      sub={elsewhere(ctx, chat.projectId)?.name}
      right={
        (chat.pinned || chat.at) && (
          <>
            {chat.pinned && <PinIcon aria-label="Pinned" className="size-3 text-muted-foreground" />}
            <Age at={chat.at} />
          </>
        )
      }
    />
  );
}

/** A result as one row: a task, a run, a page or a chat, with what tells it apart. */
export function HitRow({ hit, ctx }: { hit: SearchHit | SearchItem; ctx: RowContext }) {
  const match = "match" in hit ? hit.match : NO_MATCH;
  if (hit.kind === "task") return <TaskRow task={hit.task} match={match} ctx={ctx} />;
  if (hit.kind === "run") return <RunRow run={hit.run} match={match} ctx={ctx} />;
  if (hit.kind === "page") return <PageRow page={hit.page} match={match} />;
  return <ChatRow chat={hit.chat} match={match} ctx={ctx} />;
}


/** A row that does something rather than open a result: Show more, Try GitHub again, Search all projects. */
export function ActionRow({ icon, title, sub, quiet }: { icon: ReactNode; title: string; sub?: string; quiet?: boolean }) {
  return (
    <RowBody
      icon={icon}
      line={<span className={cn("min-w-0 truncate", quiet ? "text-[12.5px] text-muted-foreground" : "font-medium text-foreground")}>{title}</span>}
      sub={sub}
    />
  );
}

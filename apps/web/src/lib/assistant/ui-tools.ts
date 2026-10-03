import type { PlanStatus } from "@handoff/github";
import { planPath } from "../paths";
import type { RunFilter } from "../plan/filters";
import type { Zoom } from "../plan/timeline-scale";
import type { PlanViewName } from "../project-tab";
import { projectSettingsPath } from "../settings-tab";
import { toolSpec } from "./catalog";

/** The catalog's tools that run in the person's browser instead of on the server. */
export const UI_TOOL_NAMES = ["go_to", "go_to_inbox", "go_to_notifications", "set_project_tab", "go_to_plan", "go_to_run", "go_to_review", "go_to_try_it", "where_am_i"] as const;

/** What a UI tool does in the page: open a dashboard address, or describe the open page. */
export type UiPlan = { kind: "navigate"; href: string } | { kind: "where" };

/** A UI tool call the page refuses; its message goes back to the model. */
export class UiToolError extends Error {}

const S = "[A-Za-z0-9._~-]+";
/** The dashboard's pages, as in app/; a dynamic segment is one path segment. */
const PAGES = [
  "/",
  "/projects",
  `/projects/${S}`,
  `/projects/${S}/(runs|plan|issues|pulls|settings)`,
  `/projects/${S}/graphs/${S}`,
  `/projects/${S}/runs/${S}`,
  `/projects/${S}/runs/${S}/(review|try)/${S}`,
  `/runs/${S}`,
  `/runs/${S}/(review|try)/${S}`,
  "/inbox",
  "/notifications",
  "/settings",
  `/library/(agents|groups|mcp|skills)/${S}`,
  `/library/skills-sh/${S}(/${S})?`,
].map((p) => new RegExp(`^${p}$`));

const ID = /^[A-Za-z0-9-]+$/;
const id = (value: string, what: string) => {
  if (!ID.test(value)) throw new UiToolError(`${value} is not an id of a ${what}.`);
  return value;
};

const TAB_FILTERS: Record<string, { param: string; values: string[] } | undefined> = {
  issues: { param: "issues", values: ["todo", "started", "all"] },
  pulls: { param: "pr", values: ["open", "merged", "closed", "all", "archived"] },
};

/** A dashboard path from a path or URL; refuses another origin and a path that is no page. */
function dashboardHref(path: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(path, origin);
  } catch {
    throw new UiToolError(`${path} is not a dashboard path.`);
  }
  if (url.origin !== origin) throw new UiToolError(`go_to only opens pages of this dashboard (${origin}).`);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  if (!PAGES.some((page) => page.test(pathname))) throw new UiToolError(`The dashboard has no page at ${pathname}.`);
  return `${pathname}${url.search}${url.hash}`;
}

/**
 * What a UI tool call does in the page, from the arguments the model sent. It checks the arguments
 * against the catalog and builds only addresses of this dashboard, the way its pages read them.
 */
export function planUiTool(name: string, args: unknown, origin: string): UiPlan {
  const spec = toolSpec(name);
  if (spec.kind !== "ui") throw new UiToolError(`${name} is not a UI tool.`);
  const parsed = spec.input.safeParse(args ?? {});
  if (!parsed.success) throw new UiToolError(`The arguments for ${name} are not valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  const a = parsed.data as Record<string, string | undefined>;
  const navigate = (href: string): UiPlan => ({ kind: "navigate", href });
  switch (name) {
    case "go_to":
      return navigate(dashboardHref(a.path!, origin));
    case "go_to_inbox":
      return navigate(a.project_id ? `/inbox?${new URLSearchParams({ project: id(a.project_id, "project") })}` : "/inbox");
    case "go_to_notifications":
      return navigate(a.filter ? `/notifications?${new URLSearchParams({ show: a.filter })}` : "/notifications");
    case "set_project_tab": {
      const query = new URLSearchParams();
      if (a.filter) {
        const filters = TAB_FILTERS[a.tab!];
        if (!filters) throw new UiToolError(`The ${a.tab} tab has no filter.`);
        if (!filters.values.includes(a.filter)) throw new UiToolError(`The ${a.tab} tab filters by ${filters.values.slice(0, -1).join(", ")} or ${filters.values.at(-1)}.`);
        query.set(filters.param, a.filter);
      }
      // The graphs are a section of project settings.
      if (a.tab === "graphs") return navigate(projectSettingsPath(id(a.project_id!, "project"), "graphs"));
      const search = query.toString();
      return navigate(`/projects/${id(a.project_id!, "project")}/${a.tab}${search ? `?${search}` : ""}`);
    }
    case "go_to_plan": {
      const p = parsed.data as { project_id: string; view?: PlanViewName; epic?: number | "unplanned"; status?: PlanStatus[]; run?: RunFilter; zoom?: Zoom };
      return navigate(planPath(id(p.project_id, "project"), p));
    }
    case "go_to_run":
      return navigate(`/runs/${id(a.run_id!, "run")}`);
    case "go_to_review":
      return navigate(`/runs/${id(a.run_id!, "run")}/review/${id(a.question_id!, "question")}`);
    case "go_to_try_it":
      return navigate(`/runs/${id(a.run_id!, "run")}/try/${id(a.question_id!, "question")}`);
    case "where_am_i":
      return { kind: "where" };
    default:
      throw new UiToolError(`${name} is not a UI tool.`);
  }
}

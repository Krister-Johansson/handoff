import type { App } from "@modelcontextprotocol/ext-apps";
import type { Transport } from "@modelcontextprotocol/client";
import { startView, valueOf, type ViewHost } from "../shared/app";
import { renderState } from "../shared/dom";
import { isPlan, planUrlOf, renderPlanList, type PlanData } from "./view";

/**
 * The dashboard's Plan page when no run of the plan gives it: list_projects, a read, has each project's page. Without
 * a project in the tool's input the server chose it, so the view cannot tell which one it is.
 */
async function findPlanUrl(host: ViewHost, project: string | undefined) {
  if (!host.call || !project) return undefined;
  const listed = await host.call("list_projects", {});
  if (!listed.ok || !Array.isArray(listed.value)) return undefined;
  const found = (listed.value as { name?: unknown; id?: unknown; url?: unknown }[]).find((p) => p.name === project || p.id === project);
  return typeof found?.url === "string" ? `${found.url}/plan` : undefined;
}

/** Starts the Plan list in `root` as an MCP Apps view of list_plan. */
export function startPlanList(root: HTMLElement, transport?: Transport): Promise<App> {
  let project: string | undefined;
  renderState(root, "Loading the plan…");
  return startView(
    "plan list",
    {
      input: (args) => {
        project = typeof args.project === "string" ? args.project : undefined;
      },
      result: (result, host) => {
        const shown = valueOf(result, "list_plan");
        if (!shown.ok) return renderState(root, shown.error, true);
        if (!isPlan(shown.value)) return renderState(root, "list_plan returned no plan.", true);
        const plan: PlanData = shown.value;
        const ctx = { host, project };
        const planUrl = planUrlOf(plan);
        renderPlanList(root, plan, ctx, planUrl);
        if (!planUrl) void findPlanUrl(host, project).then((url) => url && renderPlanList(root, plan, ctx, url));
      },
    },
    transport,
  );
}

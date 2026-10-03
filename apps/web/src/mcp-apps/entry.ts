// The views' one script as pnpm build:mcp-apps bundles it into each view's HTML document (see ./bundle.ts). Every
// view shares the MCP Apps runtime; the page names the view to start in its root's data-view.
import { startNeedsYou } from "./needs-you/main";
import { startPermissionCard } from "./permission-card/main";
import { startPlanList } from "./plan-list/main";
import { startQuestionCard } from "./question-card/main";
import { startRunCard } from "./run-card/main";

const VIEWS: Record<string, (root: HTMLElement) => Promise<unknown>> = {
  "run-card": startRunCard,
  "needs-you": startNeedsYou,
  "permission-card": startPermissionCard,
  "question-card": startQuestionCard,
  "plan-list": startPlanList,
};

const root = document.getElementById("root")!;
void VIEWS[root.dataset.view ?? ""]?.(root);

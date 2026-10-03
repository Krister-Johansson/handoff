// Bundles the dashboard's MCP Apps views into apps/web/src/mcp-apps/views.generated.ts, and the sandbox proxy
// that frames them in the assistant panel into apps/web/src/mcp-apps/sandbox-proxy.generated.ts (pnpm build:mcp-apps).
import { writeFile } from "node:fs/promises";
import {
  buildSandboxProxyScript,
  buildViews,
  GENERATED_FILE,
  generatedSource,
  SANDBOX_GENERATED_FILE,
  sandboxGeneratedSource,
  VIEWS,
  viewHtml,
} from "../apps/web/src/mcp-apps/bundle.ts";

const built = await buildViews();
await writeFile(GENERATED_FILE, generatedSource(built));
const kb = (text: string) => Math.round(Buffer.byteLength(text) / 1024);
console.log(`Wrote ${GENERATED_FILE} (${kb(built.script)} KB of script and ${kb(built.style)} KB of style, shared by the views).`);
for (const view of VIEWS) console.log(`  ${view.name}: ${kb(viewHtml(view, built))} KB of HTML`);

const proxy = await buildSandboxProxyScript();
await writeFile(SANDBOX_GENERATED_FILE, sandboxGeneratedSource(proxy));
console.log(`Wrote ${SANDBOX_GENERATED_FILE} (${kb(proxy)} KB of script).`);

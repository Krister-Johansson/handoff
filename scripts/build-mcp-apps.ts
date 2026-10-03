// Bundles the dashboard's MCP Apps views into apps/web/src/mcp-apps/run-card.generated.ts, and the sandbox proxy
// that frames them in the assistant panel into apps/web/src/mcp-apps/sandbox-proxy.generated.ts (pnpm build:mcp-apps).
import { writeFile } from "node:fs/promises";
import {
  buildRunCardHtml,
  buildSandboxProxyScript,
  GENERATED_FILE,
  generatedSource,
  SANDBOX_GENERATED_FILE,
  sandboxGeneratedSource,
} from "../apps/web/src/mcp-apps/bundle.ts";

const html = await buildRunCardHtml();
await writeFile(GENERATED_FILE, generatedSource(html));
console.log(`Wrote ${GENERATED_FILE} (${Math.round(html.length / 1024)} KB of HTML).`);

const proxy = await buildSandboxProxyScript();
await writeFile(SANDBOX_GENERATED_FILE, sandboxGeneratedSource(proxy));
console.log(`Wrote ${SANDBOX_GENERATED_FILE} (${Math.round(proxy.length / 1024)} KB of script).`);

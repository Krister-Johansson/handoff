// Bundles the dashboard's MCP Apps views into apps/web/src/mcp-apps/run-card.generated.ts (pnpm build:mcp-apps).
import { writeFile } from "node:fs/promises";
import { buildRunCardHtml, GENERATED_FILE, generatedSource } from "../apps/web/src/mcp-apps/bundle.ts";

const html = await buildRunCardHtml();
await writeFile(GENERATED_FILE, generatedSource(html));
console.log(`Wrote ${GENERATED_FILE} (${Math.round(html.length / 1024)} KB of HTML).`);

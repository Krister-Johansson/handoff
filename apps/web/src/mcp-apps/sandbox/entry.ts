// The sandbox proxy's script as pnpm build:mcp-apps bundles it into its page (see ./proxy-page.ts).
import { startSandboxProxy } from "./proxy";

const host = document.querySelector<HTMLMetaElement>('meta[name="handoff-host-origin"]')?.content;
if (host) startSandboxProxy(window, host);

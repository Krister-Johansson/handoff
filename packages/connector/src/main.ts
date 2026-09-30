import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBridge } from "./bridge.ts";

// Claude Code starts this with the plugin's settings in the environment (see plugins/handoff).
const bridge = createBridge({
  url: process.env.HANDOFF_URL || "http://localhost:3000",
  token: process.env.HANDOFF_TOKEN ?? "",
  pollMs: Number(process.env.HANDOFF_POLL_MS) || 15_000,
});
await bridge.start(new StdioServerTransport());
const exit = () => void bridge.stop().finally(() => process.exit(0));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, exit);
// Claude Code closing stdin means the session is over; the poll timer would otherwise keep us alive.
process.stdin.on("end", exit);

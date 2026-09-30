const SKIP = new Set(["mcp", "api", "www"]);
const ENDINGS = new Set(["com", "net", "org", "io", "dev", "ai", "app", "co", "uk", "sh", "so", "cloud", "tech"]);

/** A library name for an MCP server from its URL's host: mcp.context7.com becomes context7. */
export function suggestMcpName(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (/^[\d.]+$/.test(host)) return `mcp-${host.replaceAll(".", "-")}`;
  const labels = host.split(".");
  while (labels.length > 1 && ENDINGS.has(labels.at(-1)!)) labels.pop();
  const kept = labels.filter((l) => !SKIP.has(l));
  return (kept.length ? kept : labels).join("-").replace(/[^a-z0-9-]/g, "-");
}

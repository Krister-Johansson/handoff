import { headers } from "next/headers";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether a Host header names this machine, with any port. */
export function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return LOCAL_HOSTS.has(name.toLowerCase());
}

/** Whether a browser's Origin header is absent or the same local dashboard as the Host. */
export function isSameLocalOrigin(origin: string | null, host: string | null): boolean {
  if (!isLocalHost(host)) return false;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * The dashboard has no login: it is bound to this machine. Actions that hand out or change the agent
 * token call this, so they only answer the dashboard itself on a local address.
 */
export async function authorizeLocalRequest(): Promise<void> {
  const h = await headers();
  if (!isSameLocalOrigin(h.get("origin"), h.get("host"))) throw new Error("Only the local dashboard can change agent connections.");
}

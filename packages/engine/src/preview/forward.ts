/** The forwarder's file name, written next to the app's log in the worktree's git directory. */
export const FORWARDER_FILE = "handoff-forward.mjs";

/** What the forwarder prints once it listens on every port; startPreviewContainer waits for it. */
export const FORWARDER_READY = "handoff-forward: ready";

/**
 * The main process of an app's container, run by the image's Node with the service ports as arguments.
 * For each port P it listens on 127.0.0.1:P and [::1]:P inside the container and forwards each
 * connection to host.docker.internal:P, so the app reaches the services at the same localhost ports as
 * on the host. It ignores SIGTERM, which keeps the container up while stopping the app's processes,
 * and stays up with no ports at all. A port it cannot listen on on 127.0.0.1 ends it with a message.
 */
export const forwarderScript = `// Written by handoff: forwards the project's service ports from localhost in the app's container to the host.
import { connect, createServer } from "node:net";

process.on("SIGTERM", () => {});
setInterval(() => {}, 1 << 30);

const listen = (port, host) =>
  new Promise((resolve) => {
    const server = createServer((client) => {
      const upstream = connect({ host: "host.docker.internal", port });
      client.pipe(upstream).pipe(client);
      const close = () => (client.destroy(), upstream.destroy());
      for (const socket of [client, upstream]) socket.on("error", close).on("close", close);
    });
    server.once("error", (error) => resolve(host === "::1" ? undefined : \`cannot listen on \${host}:\${port}: \${error.message}\`));
    server.listen(port, host, () => resolve(undefined));
  });

const ports = process.argv.slice(2).map(Number);
const failed = (await Promise.all(ports.flatMap((port) => [listen(port, "127.0.0.1"), listen(port, "::1")]))).filter(Boolean);
if (failed.length > 0) {
  console.log(\`handoff-forward: \${failed.join("; ")}\`);
  process.exit(1);
}
console.log(${JSON.stringify(FORWARDER_READY)});
`;

type ComposePort ={ published?: string | number; protocol?: string };
type ComposeConfig = { services?: Record<string, { ports?: ComposePort[] | null } | null> };

/**
 * The host ports an app's container forwards to the services: every TCP port the compose file publishes
 * as a single number, read from `docker compose config --format json`, without the app's own port.
 * Sorted, each once.
 */
export function servicePorts(composeConfigJson: string, appPort: number): number[] {
  const config = JSON.parse(composeConfigJson) as ComposeConfig;
  const ports = new Set<number>();
  for (const service of Object.values(config.services ?? {})) {
    for (const p of service?.ports ?? []) {
      if ((p.protocol ?? "tcp") !== "tcp") continue;
      const published = Number(p.published);
      if (Number.isInteger(published) && published > 0 && published !== appPort) ports.add(published);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

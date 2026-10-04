import { expect, test } from "vitest";
import { servicePorts } from "./forward.ts";

/** `docker compose config --format json` as Docker Compose prints it: short port syntax expanded, ranges one entry per port. */
const config = (services: Record<string, { ports?: object[] }>) => JSON.stringify({ name: "todo", services });

test("the forwarded ports are the compose file's published ports, without the app's port", () => {
  const json = config({
    db: {
      ports: [
        { mode: "ingress", target: 5432, published: "5432", protocol: "tcp" },
        { mode: "ingress", host_ip: "127.0.0.1", target: 6379, published: "6380", protocol: "tcp" },
        { mode: "ingress", target: 9000, protocol: "tcp" },
        { mode: "ingress", target: 53, published: "5353", protocol: "udp" },
      ],
    },
    mail: { ports: [{ mode: "ingress", target: 1025, published: "41234", protocol: "tcp" }, { mode: "ingress", target: 8025, published: "8025", protocol: "tcp" }] },
    cache: { ports: [{ mode: "ingress", target: 6379, published: "5432", protocol: "tcp" }] },
  });
  expect(servicePorts(json, 41234)).toEqual([5432, 6380, 8025]);
});

test("a compose file without published ports forwards nothing", () => {
  expect(servicePorts(config({ worker: {}, db: { ports: [{ mode: "ingress", target: 5432, protocol: "tcp" }] } }), 41234)).toEqual([]);
  expect(servicePorts(JSON.stringify({ name: "empty" }), 41234)).toEqual([]);
});

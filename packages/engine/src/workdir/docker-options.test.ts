import { resolve } from "node:path";
import { expect, test } from "vitest";
import { dockerOptionsFromEnv } from "./docker-options.ts";

const user = `${process.getuid!()}:${process.getgid!()}`;

test("Docker options come from HANDOFF_DOCKER_IMAGE, HANDOFF_HOME with HANDOFF_DOCKER_MOUNTS, and HANDOFF_DOCKER_NETWORK, as the worker read them", () => {
  expect(
    dockerOptionsFromEnv({
      HANDOFF_HOME: "./home",
      HANDOFF_DOCKER_IMAGE: "img:1",
      HANDOFF_DOCKER_MOUNTS: " /cache , ,/data",
      HANDOFF_DOCKER_NETWORK: "egress",
    }),
  ).toEqual({ image: "img:1", mounts: [resolve("./home"), "/cache", "/data"], network: "egress", user });
});

test("without the Docker variables the options are the runner image, HANDOFF_HOME alone and no network", () => {
  expect(dockerOptionsFromEnv({ HANDOFF_DOCKER_NETWORK: "", HANDOFF_DOCKER_MOUNTS: " " })).toEqual({
    image: "handoff-runner:2.1.285",
    mounts: [resolve("./.handoff")],
    user,
  });
});

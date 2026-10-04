import { connect } from "node:net";

/** How long one readiness check waits for the app's first byte. */
export const ANSWER_TIMEOUT_MS = 5_000;

/**
 * Whether the app on `port` answers through 127.0.0.1, the path the person's browser takes to an app in
 * a container: it sends `GET / HTTP/1.0` and counts any bytes back within `timeoutMs` as an answer. A
 * TCP connect alone is not enough, since Docker's port proxy accepts a connection to a published port
 * and then closes it when nothing in the container listens.
 */
export function answers(port: number, timeoutMs = ANSWER_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (answered: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(answered);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => socket.write("GET / HTTP/1.0\r\nHost: localhost\r\n\r\n"));
    socket.once("data", () => done(true));
    socket.once("end", () => done(false));
    socket.once("close", () => done(false));
    socket.once("error", () => done(false));
  });
}

import { createServer, type Socket } from "node:net";
import { expect, onTestFinished, test } from "vitest";
import { answers } from "./ready.ts";

/** A TCP server on 127.0.0.1 that does `onConnection` with each connection, closed when the test ends. */
async function server(onConnection: (socket: Socket) => void): Promise<number> {
  const sockets: Socket[] = [];
  const s = createServer((socket) => (sockets.push(socket), onConnection(socket)));
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => new Promise<void>((resolve) => (sockets.forEach((socket) => socket.destroy()), s.close(() => resolve()))));
  return (s.address() as { port: number }).port;
}

test("a server that accepts and closes without a byte is not ready", async () => {
  // What Docker Desktop's port proxy does when nothing listens in the container.
  const port = await server((socket) => socket.end());
  expect(await answers(port, 2_000)).toBe(false);
});

test("a server that answers anything is ready", async () => {
  const port = await server((socket) => socket.once("data", () => socket.end("HTTP/1.1 404 Not Found\r\n\r\n")));
  expect(await answers(port, 2_000)).toBe(true);
});

test("a server that accepts and stays silent is not ready once the time is up", async () => {
  const port = await server(() => {});
  const started = Date.now();
  expect(await answers(port, 300)).toBe(false);
  expect(Date.now() - started).toBeLessThan(2_000);
});

test("a port nothing listens on is not ready", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const free = (closed.address() as { port: number }).port;
  await new Promise((resolve) => closed.close(resolve));
  expect(await answers(free, 1_000)).toBe(false);
});

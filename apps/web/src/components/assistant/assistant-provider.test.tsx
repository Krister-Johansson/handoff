import { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { AssistantPort, PendingRequest } from "@/lib/assistant/port";
import { FakeAssistantTransport } from "@/lib/assistant/testing/fake-assistant-transport";
import { AssistantProvider, useAssistant } from "./assistant-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

function Grab({ onPort }: { onPort: (port: AssistantPort) => void }) {
  const port = useAssistant();
  useEffect(() => {
    onPort(port);
  }, [onPort, port]);
  return null;
}

function setup() {
  const transport = new FakeAssistantTransport();
  let current: AssistantPort | undefined;
  const onPort = (port: AssistantPort) => (current = port);
  render(
    <AssistantProvider transport={transport} available>
      <Grab onPort={onPort} />
    </AssistantProvider>,
  );
  return { transport, port: () => current! };
}

test("an input adapter sends through the port with its source, and an onReply listener hears each delta and one done reply", async () => {
  const { transport, port } = setup();
  const replies: { text: string; done: boolean }[] = [];
  port().onReply((r) => replies.push({ text: r.text, done: r.done }));
  let sending!: Promise<void>;
  act(() => {
    sending = port().send("open the inbox", { source: "voice" });
  });
  await waitFor(() => expect(transport.turns).toEqual([{ conversationId: "c1", text: "open the inbox", source: "voice" }]));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "text", text: "Opening " }));
  act(() => transport.emit({ type: "text", text: "it." }));
  act(() => transport.emit({ type: "done", text: "Opening it." }));
  await act(() => sending);
  expect(replies).toEqual([
    { text: "Opening ", done: false },
    { text: "Opening it.", done: false },
    { text: "Opening it.", done: true },
  ]);
  expect(port().status).toBe("idle");
});

test("onRequest delivers approval requests and respond answers them", async () => {
  const { transport, port } = setup();
  const requests: PendingRequest[] = [];
  port().onRequest((r) => requests.push(r));
  let sending!: Promise<void>;
  act(() => {
    sending = port().send("cancel it");
  });
  await waitFor(() => expect(transport.turns).toHaveLength(1));
  act(() => transport.emit({ type: "turn", turnId: "t1" }));
  act(() => transport.emit({ type: "confirm", requestId: "r1", toolUseId: "u1", name: "cancel_run", title: "Cancel a run", summary: "Cancel run 7f3a", args: {} }));
  expect(requests).toEqual([expect.objectContaining({ requestId: "r1", name: "cancel_run", summary: "Cancel run 7f3a" })]);
  await act(() => port().respond("r1", { approve: false, note: "no" }));
  expect(transport.replies).toEqual([{ turnId: "t1", requestId: "r1", approved: false, note: "no" }]);
  act(() => transport.emit({ type: "done", text: "Left it." }));
  await act(() => sending);
});

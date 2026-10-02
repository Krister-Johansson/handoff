import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PageDescriptor } from "../../lib/assistant/page-tools";

/** What a turn streams to the panel. */
export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; title: string; summary: string; args: unknown }
  | { type: "tool_result"; id: string; result: string; isError: boolean }
  | { type: "confirm"; requestId: string; toolUseId: string | undefined; name: string; title: string; summary: string; args: unknown; expiresAt?: string }
  | { type: "confirmed"; requestId: string; approved: boolean; note?: string }
  | { type: "ui_call"; requestId: string; name: string; args: unknown }
  | { type: "done"; text: string; costUsd?: number }
  | { type: "interrupted"; text: string }
  | { type: "error"; message: string };

/** What the person answered on an approval card. */
export type Approval = { approved: boolean; note?: string };

/** What the page answered to a UI tool call. */
export type UiResult = { text: string; isError: boolean };

type Pending = { resolve: (answer: Approval) => void; timer: NodeJS.Timeout };
type PendingUi = { resolve: (result: UiResult) => void; timer: NodeJS.Timeout };

/**
 * A turn while it runs: its token for the turn's MCP endpoint, the events it streamed (so a panel that
 * connects late, or reconnects, gets all of them), and the approvals that wait for the person. Turns
 * live in memory only; a token is forgotten when its turn ends.
 */
export class LiveTurn {
  readonly id = randomUUID();
  readonly token = randomBytes(32).toString("base64url");
  readonly controller = new AbortController();
  readonly events: TurnEvent[] = [];
  /** The person's answers by the tool call they were for, for the stored reply. */
  readonly approvals = new Map<string, Approval & { at: string }>();
  private readonly listeners = new Set<(event: TurnEvent) => void>();
  private readonly pending = new Map<string, Pending>();
  private readonly pendingUi = new Map<string, PendingUi>();
  ended = false;

  /** `page` is the page the person asked on, as the turn's route validated it: its tools are the turn's page tools. */
  constructor(
    readonly conversationId: string,
    readonly page?: PageDescriptor,
  ) {}

  emit(event: TurnEvent) {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }

  /** Every event so far, then each new one, until `stop` is called. */
  subscribe(listener: (event: TurnEvent) => void): () => void {
    for (const event of this.events) listener(event);
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Asks the person to approve a call and waits for the answer; no answer in time is a denial. */
  requestApproval(call: { toolUseId: string | undefined; name: string; title: string; summary: string; args: unknown }, timeoutMs: number): Promise<Approval> {
    if (this.ended) return Promise.resolve({ approved: false, note: "The turn has ended." });
    const requestId = randomUUID();
    return new Promise<Approval>((resolve) => {
      const settle = (answer: Approval) => {
        clearTimeout(this.pending.get(requestId)?.timer);
        this.pending.delete(requestId);
        if (call.toolUseId) this.approvals.set(call.toolUseId, { ...answer, at: new Date().toISOString() });
        this.emit({ type: "confirmed", requestId, approved: answer.approved, ...(answer.note ? { note: answer.note } : {}) });
        resolve(answer);
      };
      const timer = setTimeout(() => settle({ approved: false, note: "No one approved this in time." }), timeoutMs);
      this.pending.set(requestId, { resolve: settle, timer });
      this.emit({ type: "confirm", requestId, ...call, expiresAt: new Date(Date.now() + timeoutMs).toISOString() });
    });
  }

  /** The person's answer to an approval card. False when the card is no longer open. */
  answer(requestId: string, answer: Approval): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    pending.resolve(answer);
    return true;
  }

  /** Asks the page to run a UI tool and waits for its answer; no answer in time is an error for the model. */
  requestUi(call: { name: string; args: unknown }, timeoutMs: number): Promise<UiResult> {
    if (this.ended) return Promise.resolve({ text: "The turn has ended.", isError: true });
    const requestId = randomUUID();
    return new Promise<UiResult>((resolve) => {
      const settle = (result: UiResult) => {
        clearTimeout(this.pendingUi.get(requestId)?.timer);
        this.pendingUi.delete(requestId);
        resolve(result);
      };
      const timer = setTimeout(() => settle({ text: "The page did not answer. The person may have closed the dashboard.", isError: true }), timeoutMs);
      this.pendingUi.set(requestId, { resolve: settle, timer });
      this.emit({ type: "ui_call", requestId, ...call });
    });
  }

  /** The page's answer to a UI tool call. False when the call is no longer waiting. */
  answerUi(requestId: string, result: UiResult): boolean {
    const pending = this.pendingUi.get(requestId);
    if (!pending) return false;
    pending.resolve(result);
    return true;
  }

  /** Denies every open approval and ends every waiting UI call, as stopping the turn does. */
  denyAll(note: string) {
    for (const pending of [...this.pending.values()]) pending.resolve({ approved: false, note });
    for (const pending of [...this.pendingUi.values()]) pending.resolve({ text: note, isError: true });
  }
}

const registry = globalThis as unknown as { handoffAssistantTurns?: Map<string, LiveTurn> };
const turns = () => (registry.handoffAssistantTurns ??= new Map<string, LiveTurn>());

/** Starts a turn of a conversation; refused while another turn of it runs. */
export function openTurn(conversationId: string, page?: PageDescriptor): LiveTurn {
  for (const turn of turns().values()) {
    if (turn.conversationId === conversationId) throw new TurnRunningError("This conversation is already answering. Wait for it, or stop it.");
  }
  const turn = new LiveTurn(conversationId, page);
  turns().set(turn.id, turn);
  return turn;
}

/** Ends a turn: its token stops working and its open approvals are denied. */
export function closeTurn(turn: LiveTurn) {
  turn.ended = true;
  turn.denyAll("The turn has ended.");
  turns().delete(turn.id);
}

export const findTurn = (id: string) => turns().get(id);

/** The running turn a bearer token belongs to. */
export function turnByToken(authorization: string | null): LiveTurn | undefined {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return undefined;
  for (const turn of turns().values()) {
    const a = Buffer.from(token);
    const b = Buffer.from(turn.token);
    if (a.length === b.length && timingSafeEqual(a, b)) return turn;
  }
  return undefined;
}

export class TurnRunningError extends Error {}

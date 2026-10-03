"use client";

import { useState } from "react";
import type { PendingRequest, ToolCallView } from "@/lib/assistant/port";
import type { AppViewResource } from "@/lib/assistant/transport";
import type { ViewToolCall, ViewToolResult } from "@/lib/assistant/view-tools";
import { McpAppView } from "./app-view";
import { ApprovalCard } from "./approval-card";
import { ToolRows } from "./tool-rows";

/**
 * What the panel gives the cards of MCP Apps views: their resources, a runner for the tools a view calls (from
 * the card of tool call `viewCallId`), and the approval cards those calls wait on.
 */
export type ViewHost = {
  load(uri: string): Promise<AppViewResource>;
  callTool(viewCallId: string, call: ViewToolCall, signal?: AbortSignal): Promise<ViewToolResult>;
  requests: PendingRequest[];
};

const DRAWN = new Set<ToolCallView["status"]>(["running", "done"]);
const adding = (id: string) => (set: ReadonlySet<string>) => new Set(set).add(id);

/**
 * A reply's tool calls: the rows, then a card for each call whose tool has an MCP Apps view, as the chat mock
 * draws them, with the approval cards of the tools that view called under it. A card's row stops opening to the
 * raw result once the card shows; a card whose view fails gives way, and its row opens to the result as before.
 * Failed and denied calls get no card.
 */
export function ReplyCalls({ calls, views }: { calls: ToolCallView[]; views: ViewHost | undefined }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set());
  const cards = views ? calls.filter((c) => c.view && DRAWN.has(c.status) && !failed.has(c.id)) : [];
  const carded = new Set(cards.flatMap((c) => (shown.has(c.id) ? [c.id] : [])));
  return (
    <>
      <ToolRows calls={calls} carded={carded} />
      {views &&
        cards.map((call) => (
          <div key={call.id} className="flex flex-col gap-2">
            <McpAppView
              call={call}
              load={views.load}
              callTool={(request, signal) => views.callTool(call.id, request, signal)}
              onFail={() => setFailed(adding(call.id))}
              onReady={() => setShown(adding(call.id))}
            />
            {views.requests
              .filter((r) => r.viewCallId === call.id)
              .map((request) => (
                <ApprovalCard key={request.requestId} request={request} />
              ))}
          </div>
        ))}
    </>
  );
}

import { expect, test } from "vitest";
import { closeTurn, openTurn } from "./relay";
import { handleTurnMcpRequest } from "./turn-mcp";

const deps = { db: {} as never, github: undefined, baseUrl: "http://localhost:3000", approvalTimeoutMs: 1000, uiTimeoutMs: 1000 };
const call = (headers: Record<string, string>) => handleTurnMcpRequest(new Request("http://localhost:3000/api/assistant/mcp", { method: "POST", headers, body: "{}" }), deps);

test("the MCP endpoint refuses a missing, wrong or expired turn token and a browser origin", async () => {
  expect((await call({})).status).toBe(401);
  expect((await call({ authorization: "Bearer not-a-turn" })).status).toBe(401);
  const turn = openTurn("c1");
  expect((await call({ authorization: `Bearer ${turn.token}`, origin: "http://localhost:3000" })).status).toBe(403);
  closeTurn(turn);
  expect((await call({ authorization: `Bearer ${turn.token}` })).status).toBe(401);
});

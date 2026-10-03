import { expect, test, vi } from "vitest";
import { RUN_CARD_HTML } from "@/mcp-apps/run-card.generated";
import { GET } from "./route";

vi.mock("@/server/mcp-apps-sandbox", () => ({ sandboxProxyOrigin: async () => "http://127.0.0.1:49152" }));

const get = (uri: string, origin?: string) =>
  GET(new Request(`http://localhost:3000/api/assistant/views?uri=${encodeURIComponent(uri)}`, { headers: { host: "localhost:3000", ...(origin ? { origin } : {}) } }));

test("the panel reads a tool's view: its HTML, CSP and border, and the sandbox proxy page that frames it for this dashboard", async () => {
  const response = await get("ui://handoff/run-card.html");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    uri: "ui://handoff/run-card.html",
    html: RUN_CARD_HTML,
    csp: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    prefersBorder: false,
    sandbox: `http://127.0.0.1:49152/sandbox?host=${encodeURIComponent("http://localhost:3000")}`,
  });
});

test("the proxy page is framed by the dashboard as the browser names it, which may differ from the server's own name", async () => {
  const response = await GET(new Request("http://localhost:3046/api/assistant/views?uri=ui%3A%2F%2Fhandoff%2Frun-card.html", { headers: { host: "127.0.0.1:3046" } }));
  expect((await response.json()).sandbox).toBe(`http://127.0.0.1:49152/sandbox?host=${encodeURIComponent("http://127.0.0.1:3046")}`);
});

test("only the local dashboard reads views, and only views a tool has", async () => {
  expect((await get("ui://handoff/run-card.html", "https://evil.example")).status).toBe(403);
  expect((await get("ui://handoff/nope.html")).status).toBe(404);
});

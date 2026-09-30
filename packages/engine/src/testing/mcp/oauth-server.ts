import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export type OAuthMcpServer = {
  /** The MCP endpoint, which answers 401 without a token this server issued. */
  url: string;
  /** Access tokens issued so far, by the code exchange or by refresh. */
  issued: () => string[];
  close: () => Promise<void>;
};

const body = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk.toString()));
    req.on("end", () => resolve(data));
  });

const json = (res: ServerResponse, status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));

/**
 * An MCP server behind its own OAuth authorization server, as Context7's /mcp/oauth is: protected
 * resource metadata, dynamic client registration, an /authorize endpoint that approves at once and
 * redirects back with a code, PKCE-checked code exchange and refresh. With `open` the MCP endpoint
 * answers without a token.
 */
export async function startOAuthMcpServer(opts: { accessTtlSeconds?: number; open?: boolean } = {}): Promise<OAuthMcpServer> {
  const clients = new Set<string>();
  const codes = new Map<string, { challenge: string; clientId: string }>();
  const accessTokens: string[] = [];
  const refreshTokens = new Set<string>();
  let origin = "";

  const issue = (res: ServerResponse) => {
    const n = accessTokens.length + 1;
    accessTokens.push(`at-${n}`);
    refreshTokens.add(`rt-${n}`);
    json(res, 200, { access_token: `at-${n}`, token_type: "Bearer", expires_in: opts.accessTtlSeconds ?? 3600, refresh_token: `rt-${n}` });
  };

  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", origin);
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/register" && req.method === "POST") {
      const clientId = `client-${clients.size + 1}`;
      clients.add(clientId);
      return json(res, 201, { ...JSON.parse(await body(req)), client_id: clientId });
    }
    if (url.pathname === "/authorize") {
      const clientId = url.searchParams.get("client_id") ?? "";
      const redirect = url.searchParams.get("redirect_uri");
      if (!clients.has(clientId) || !redirect || url.searchParams.get("code_challenge_method") !== "S256") return json(res, 400, { error: "invalid_request" });
      const code = randomUUID();
      codes.set(code, { challenge: url.searchParams.get("code_challenge") ?? "", clientId });
      const back = new URL(redirect);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") ?? "");
      return res.writeHead(302, { location: back.toString() }).end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const form = new URLSearchParams(await body(req));
      if (form.get("grant_type") === "authorization_code") {
        const pending = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const challenge = createHash("sha256")
          .update(form.get("code_verifier") ?? "")
          .digest("base64url");
        if (!pending || pending.clientId !== form.get("client_id") || pending.challenge !== challenge) return json(res, 400, { error: "invalid_grant" });
        return issue(res);
      }
      if (form.get("grant_type") === "refresh_token" && refreshTokens.delete(form.get("refresh_token") ?? "")) return issue(res);
      return json(res, 400, { error: "invalid_grant" });
    }
    if (url.pathname === "/mcp") {
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      if (!opts.open && (!token || !accessTokens.includes(token))) {
        res.writeHead(401, { "content-type": "application/json", "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
        return res.end(JSON.stringify({ error: "invalid_token" }));
      }
      const server = new McpServer({ name: "oauth-docs", version: "2.0.0" });
      server.registerTool("resolve", { description: "Resolve a library" }, async () => ({ content: [{ type: "text", text: "x" }] }));
      // Stateless mode; the casts only bridge the SDK's optional-property types and exactOptionalPropertyTypes.
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined } as never);
      res.on("close", () => void transport.close());
      await server.connect(transport as never);
      return transport.handleRequest(req, res);
    }
    json(res, 404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  return {
    url: `${origin}/mcp`,
    issued: () => [...accessTokens],
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}

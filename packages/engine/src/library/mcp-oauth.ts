import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

/** A server that needs someone to sign in through the dashboard before it can be used. */
export class McpSignInRequired extends Error {
  constructor(readonly server: string) {
    super(`MCP server ${server} needs sign-in: connect it on its library page`);
    this.name = "McpSignInRequired";
  }
}

/** Everything handoff keeps about one server's OAuth sign-in. */
type OAuthRecord = {
  serverUrl: string;
  redirectUrl: string;
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  tokensSavedAt?: number;
  discovery?: OAuthDiscoveryState;
  /** A sign-in started in the dashboard and not finished yet. */
  pending?: { state: string; codeVerifier?: string; startedAt: number };
};

const NAME = /^[a-z0-9][a-z0-9_-]*$/i;
const PENDING_TTL_MS = 15 * 60_000;
/** Refresh a token this long before it expires, so it does not run out mid-run. */
const EXPIRY_MARGIN_MS = 5 * 60_000;

/** Where the dashboard and the worker keep OAuth tokens: outside the database, the same place for both. */
export const defaultOAuthDir = (env: Record<string, string | undefined> = process.env) => env.HANDOFF_OAUTH_DIR || join(homedir(), ".handoff", "mcp-oauth");

/** OAuth records as one JSON file per MCP server, readable only by this user. Tokens never go to the database. */
export class McpOAuthStore {
  constructor(readonly dir: string) {}

  private path(name: string) {
    if (!NAME.test(name)) throw new Error(`${name} is not an MCP server name`);
    return join(this.dir, `${name}.json`);
  }

  read(name: string): OAuthRecord | undefined {
    try {
      return JSON.parse(readFileSync(this.path(name), "utf8")) as OAuthRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  write(name: string, record: OAuthRecord) {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const path = this.path(name);
    writeFileSync(path, JSON.stringify(record, null, 2), { mode: 0o600 });
    chmodSync(path, 0o600);
  }

  delete(name: string) {
    rmSync(this.path(name), { force: true });
  }

  /** The server whose unfinished sign-in carries this state. */
  findPending(state: string): string | undefined {
    let files: string[];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    } catch {
      return undefined;
    }
    return files.map((f) => f.slice(0, -".json".length)).find((name) => this.read(name)?.pending?.state === state);
  }
}

/**
 * The SDK's OAuth client for one server, backed by the store. Interactive (the dashboard) it records
 * the authorization URL for the browser; otherwise (the worker, a check) a needed sign-in throws.
 */
class StoredProvider implements OAuthClientProvider {
  authorizationUrl?: URL;

  constructor(
    private readonly store: McpOAuthStore,
    private readonly name: string,
    private readonly serverUrl: string,
    readonly redirectUrl: string,
    private readonly interactive: boolean,
    private readonly now: () => number = Date.now,
  ) {}

  private record(): OAuthRecord {
    const record = this.store.read(this.name);
    return record && record.serverUrl === this.serverUrl && record.redirectUrl === this.redirectUrl ? record : { serverUrl: this.serverUrl, redirectUrl: this.redirectUrl };
  }

  private update(patch: Partial<OAuthRecord>) {
    this.store.write(this.name, { ...this.record(), ...patch });
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "handoff",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state() {
    return this.record().pending?.state ?? "";
  }
  clientInformation() {
    return this.record().client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    this.update({ client });
  }
  tokens() {
    return this.record().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.update({ tokens, tokensSavedAt: this.now() });
  }
  redirectToAuthorization(url: URL) {
    if (!this.interactive) throw new McpSignInRequired(this.name);
    this.authorizationUrl = url;
  }
  saveCodeVerifier(codeVerifier: string) {
    const { pending } = this.record();
    if (pending) this.update({ pending: { ...pending, codeVerifier } });
  }
  codeVerifier() {
    const verifier = this.record().pending?.codeVerifier;
    if (!verifier) throw new Error(`no sign-in in progress for ${this.name}`);
    return verifier;
  }
  saveDiscoveryState(discovery: OAuthDiscoveryState) {
    this.update({ discovery });
  }
  discoveryState() {
    return this.record().discovery;
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    const record = this.record();
    if (scope === "all") return this.store.delete(this.name);
    const { client, tokens, tokensSavedAt, discovery, pending, ...rest } = record;
    this.store.write(this.name, {
      ...rest,
      ...(scope !== "client" && client ? { client } : {}),
      ...(scope !== "tokens" && tokens ? { tokens, ...(tokensSavedAt ? { tokensSavedAt } : {}) } : {}),
      ...(scope !== "discovery" && discovery ? { discovery } : {}),
      ...(pending ? { pending: scope === "verifier" ? { state: pending.state, startedAt: pending.startedAt } : pending } : {}),
    });
  }
}

/**
 * Starts signing in to an MCP server from the dashboard: discovers its authorization server,
 * registers handoff as a client and returns the URL to send the browser to. A server that already
 * has a refreshable sign-in is refreshed instead.
 */
export async function beginMcpSignIn(
  store: McpOAuthStore,
  input: { name: string; serverUrl: string; redirectUrl: string },
): Promise<{ authorizationUrl: string } | { authorized: true }> {
  const current = store.read(input.name);
  const keep = current?.serverUrl === input.serverUrl && current.redirectUrl === input.redirectUrl ? current : undefined;
  // A new sign-in replaces the tokens; the registered client and discovery are kept for the same URLs.
  store.write(input.name, {
    serverUrl: input.serverUrl,
    redirectUrl: input.redirectUrl,
    ...(keep?.client ? { client: keep.client } : {}),
    ...(keep?.discovery ? { discovery: keep.discovery } : {}),
    pending: { state: randomBytes(24).toString("base64url"), startedAt: Date.now() },
  });
  const provider = new StoredProvider(store, input.name, input.serverUrl, input.redirectUrl, true);
  const result = await auth(provider, { serverUrl: input.serverUrl });
  if (result === "AUTHORIZED" || !provider.authorizationUrl) return { authorized: true };
  return { authorizationUrl: provider.authorizationUrl.toString() };
}

/** Finishes a sign-in when the authorization server redirects back with a code. */
export async function finishMcpSignIn(store: McpOAuthStore, callback: { state: string; code: string }): Promise<{ name: string }> {
  const name = callback.state ? store.findPending(callback.state) : undefined;
  const record = name ? store.read(name) : undefined;
  if (!name || !record?.pending || Date.now() - record.pending.startedAt > PENDING_TTL_MS) {
    throw new Error("This sign-in is unknown or has expired. Start it again from the MCP server's page.");
  }
  const provider = new StoredProvider(store, name, record.serverUrl, record.redirectUrl, true);
  await auth(provider, { serverUrl: record.serverUrl, authorizationCode: callback.code });
  const { pending: _done, ...signedIn } = store.read(name) ?? record;
  store.write(name, signedIn);
  return { name };
}

/** Drops an unfinished sign-in, for a callback that says the user declined. Returns the server's name. */
export function abandonMcpSignIn(store: McpOAuthStore, state: string): string | undefined {
  const name = state ? store.findPending(state) : undefined;
  const record = name ? store.read(name) : undefined;
  if (!name || !record) return undefined;
  const { pending: _abandoned, ...rest } = record;
  store.write(name, rest);
  return name;
}

const expiresAt = (record: OAuthRecord) => (record.tokens?.expires_in && record.tokensSavedAt ? record.tokensSavedAt + record.tokens.expires_in * 1000 : undefined);

/** Whether a server has a sign-in for this URL, and when its access token runs out. */
export function mcpSignInStatus(store: McpOAuthStore, name: string, serverUrl: string): { connected: boolean; expiresAt?: string; refreshable?: boolean; scope?: string } {
  const record = store.read(name);
  if (!record?.tokens || record.serverUrl !== serverUrl) return { connected: false };
  const expires = expiresAt(record);
  return {
    connected: true,
    ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}),
    refreshable: Boolean(record.tokens.refresh_token),
    ...(record.tokens.scope ? { scope: record.tokens.scope } : {}),
  };
}

/**
 * The access token for a run or a check, refreshed first when it has expired or is about to.
 * Throws McpSignInRequired when there is no sign-in to use.
 */
export async function mcpAccessToken(store: McpOAuthStore, input: { name: string; serverUrl: string; now?: number }): Promise<string> {
  const record = store.read(input.name);
  if (!record?.tokens || record.serverUrl !== input.serverUrl) throw new McpSignInRequired(input.name);
  const expires = expiresAt(record);
  if (expires === undefined || expires - EXPIRY_MARGIN_MS > (input.now ?? Date.now())) return record.tokens.access_token;
  if (!record.tokens.refresh_token) throw new McpSignInRequired(input.name);
  const provider = new StoredProvider(store, input.name, record.serverUrl, record.redirectUrl, false, () => input.now ?? Date.now());
  await auth(provider, { serverUrl: record.serverUrl });
  const refreshed = store.read(input.name)?.tokens;
  if (!refreshed) throw new McpSignInRequired(input.name);
  return refreshed.access_token;
}

export function signOutMcp(store: McpOAuthStore, name: string) {
  store.delete(name);
}

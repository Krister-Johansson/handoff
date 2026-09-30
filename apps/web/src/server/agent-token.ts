import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where the connection token lives: a file readable only by this user, never the database. */
export const defaultAgentTokenFile = (env: Record<string, string | undefined> = process.env) => env.HANDOFF_AGENT_TOKEN_FILE || join(homedir(), ".handoff", "agent-token");

/**
 * The token agents such as Claude Code send to /api/mcp. Agent connections are on while the file
 * exists; turning them off deletes it, which disconnects every agent.
 */
export class AgentTokenStore {
  constructor(readonly file: string) {}

  read(): string | undefined {
    try {
      return readFileSync(this.file, "utf8").trim() || undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  /** The current token, or a new one when agent connections were off. */
  create(): string {
    return this.read() ?? this.regenerate();
  }

  regenerate(): string {
    const token = randomBytes(32).toString("base64url");
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileSync(this.file, `${token}\n`, { mode: 0o600 });
    chmodSync(this.file, 0o600);
    return token;
  }

  disable() {
    rmSync(this.file, { force: true });
  }

  /** Whether an Authorization header carries the token, compared in constant time. */
  verify(header: string | null | undefined): boolean {
    const token = this.read();
    const sent = header?.match(/^Bearer (.+)$/)?.[1];
    if (!token || !sent) return false;
    const a = Buffer.from(sent);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}

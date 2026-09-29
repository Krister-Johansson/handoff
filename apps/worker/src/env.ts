import { z } from "zod";

const intFrom = (fallback: number) => z.coerce.number().int().positive().default(fallback);
const optional = z.string().trim().min(1).optional().catch(undefined);

const Schema = z.object({
  DATABASE_URL: z.string().min(1),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().min(1),
  HANDOFF_HOME: z.string().default("./.handoff"),
  HANDOFF_CLAUDE_BIN: z.string().default("claude"),
  HANDOFF_CLAUDE_VERSION: z.string().default("2.1.285"),
  HANDOFF_ALLOW_CLI_DRIFT: z.string().optional(),
  HANDOFF_WORKER_ID: optional,
  HANDOFF_CAP_CLI: intFrom(1),
  HANDOFF_CAP_SHELL: intFrom(4),
  HANDOFF_CAP_GITHUB: intFrom(4),
  HANDOFF_CAP_FUNCTION: intFrom(8),
  HANDOFF_MAX_TURNS: intFrom(60),
  HANDOFF_CLI_TIMEOUT_MS: intFrom(45 * 60_000),
  HANDOFF_MODEL: optional,
  GITHUB_TOKEN: optional,
  GITHUB_APP_ID: optional,
  GITHUB_APP_PRIVATE_KEY_PATH: optional,
  WEB_URL: z.string().default("http://localhost:3000"),
});

export type WorkerEnv = ReturnType<typeof parseEnv>;

export function parseEnv(source: Record<string, string | undefined>) {
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = Schema.safeParse(cleaned);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Missing or invalid environment variables: ${keys.join(", ")}. See .env.example.`);
  }
  const env = parsed.data;
  let github: { mode: "token"; token: string } | { mode: "app"; appId: number; privateKeyPath: string };
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY_PATH) {
    github = { mode: "app", appId: Number(env.GITHUB_APP_ID), privateKeyPath: env.GITHUB_APP_PRIVATE_KEY_PATH };
  } else if (env.GITHUB_TOKEN) {
    github = { mode: "token", token: env.GITHUB_TOKEN };
  } else {
    throw new Error("Set GITHUB_TOKEN or GITHUB_APP_ID with GITHUB_APP_PRIVATE_KEY_PATH. See .env.example.");
  }
  return {
    ...env,
    allowCliDrift: env.HANDOFF_ALLOW_CLI_DRIFT === "1" || env.HANDOFF_ALLOW_CLI_DRIFT === "true",
    caps: { cli: env.HANDOFF_CAP_CLI, shell: env.HANDOFF_CAP_SHELL, github: env.HANDOFF_CAP_GITHUB, human: 1000, function: env.HANDOFF_CAP_FUNCTION },
    github,
  };
}

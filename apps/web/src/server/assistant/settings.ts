import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assistantConfig, type AssistantConfig } from "./env";

export const ASSISTANT_MODELS = ["sonnet", "opus", "haiku"] as const;
export type AssistantModel = (typeof ASSISTANT_MODELS)[number];

/** What the Settings page changes: whether the assistant runs, and the model it asks for. */
export type AssistantSettings = { enabled: boolean; model?: AssistantModel };

const file = (home: string) => join(home, "settings.json");

export function readAssistantSettings(home: string): AssistantSettings {
  if (!existsSync(file(home))) return { enabled: true };
  try {
    const raw = JSON.parse(readFileSync(file(home), "utf8")) as { enabled?: unknown; model?: unknown };
    const model = ASSISTANT_MODELS.find((m) => m === raw.model);
    return { enabled: raw.enabled !== false, ...(model ? { model } : {}) };
  } catch {
    return { enabled: true };
  }
}

/** Changes the assistant's settings, kept in <assistant home>/settings.json (0600). */
export function writeAssistantSettings(home: string, patch: Partial<AssistantSettings>): AssistantSettings {
  if (patch.model !== undefined && !ASSISTANT_MODELS.includes(patch.model)) throw new Error("The model must be sonnet, opus or haiku.");
  const next = { ...readAssistantSettings(home), ...patch };
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const temp = `${file(home)}.tmp`;
  writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file(home));
  return next;
}

export type AssistantState = {
  config: AssistantConfig;
  settings: AssistantSettings;
  enabled: boolean;
  available: boolean;
  /** Why it is unavailable: no OAuth token in the dashboard's environment, or switched off in Settings. */
  reason?: "no-token" | "off";
};

/** The assistant as the dashboard runs it now: the environment's config with the Settings page's choices applied. */
export function assistantState(env: Record<string, string | undefined> = process.env): AssistantState {
  const base = assistantConfig(env);
  const settings = readAssistantSettings(base.home);
  const config = settings.model ? { ...base, model: settings.model } : base;
  const reason = !config.oauthToken ? "no-token" : settings.enabled ? undefined : "off";
  return { config, settings, enabled: settings.enabled, available: !reason, ...(reason ? { reason } : {}) };
}

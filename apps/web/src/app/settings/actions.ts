"use server";

import { revalidatePath } from "next/cache";
import { AgentTokenStore, defaultAgentTokenFile } from "@/server/agent-token";
import { assistantConfig } from "@/server/assistant/env";
import { writeAssistantSettings, type AssistantModel } from "@/server/assistant/settings";
import { authorizeLocalRequest } from "@/server/local-request";

const store = () => new AgentTokenStore(defaultAgentTokenFile());

/** Turns agent connections on, keeping the token when they already were. */
export async function enableAgentAction(): Promise<{ token: string }> {
  await authorizeLocalRequest();
  const token = store().create();
  revalidatePath("/settings");
  return { token };
}

/** Replaces the token; agents connected with the old one are refused from now on. */
export async function regenerateAgentAction(): Promise<{ token: string }> {
  await authorizeLocalRequest();
  const token = store().regenerate();
  revalidatePath("/settings");
  return { token };
}

/** Turns agent connections off by deleting the token. */
export async function disableAgentAction(): Promise<Record<string, never>> {
  await authorizeLocalRequest();
  store().disable();
  revalidatePath("/settings");
  return {};
}

/** Switches the assistant on or off for the whole dashboard. */
export async function setAssistantEnabledAction(enabled: boolean): Promise<Record<string, never>> {
  await authorizeLocalRequest();
  writeAssistantSettings(assistantConfig().home, { enabled });
  // The root layout passes availability to the panel.
  revalidatePath("/", "layout");
  return {};
}

/** The model the assistant's next turns ask Claude Code for. */
export async function setAssistantModelAction(model: AssistantModel): Promise<{ error?: string }> {
  await authorizeLocalRequest();
  try {
    writeAssistantSettings(assistantConfig().home, { model });
  } catch (error) {
    return { error: (error as Error).message };
  }
  revalidatePath("/settings");
  return {};
}

"use server";

import { revalidatePath } from "next/cache";
import { AgentTokenStore, defaultAgentTokenFile } from "@/server/agent-token";
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

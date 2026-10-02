import { setTimeout as sleep } from "node:timers/promises";

/** How many times a git command that reaches the network is tried again after it fails. */
export const NETWORK_RETRIES = 3;

/** The first wait before trying again; each later wait doubles it. */
export const NETWORK_RETRY_MS = 1_000;

/**
 * Runs a git command that reaches the network (clone, fetch, push), trying it again up to three times
 * with a doubling wait, so a dropped connection does not fail the step. The last failure is thrown.
 */
export async function withNetworkRetry<T>(command: () => Promise<T>, firstWaitMs = NETWORK_RETRY_MS): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await command();
    } catch (error) {
      if (retry >= NETWORK_RETRIES) throw error;
      await sleep(firstWaitMs * 2 ** retry);
    }
  }
}

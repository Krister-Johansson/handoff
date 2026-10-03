import type { Outcome } from "./app";
import { el } from "./dom";

/** The line under a card's buttons that says what is pending, what happened or why it did not. */
export function statusLine() {
  const line = el("p", "act");
  line.hidden = true;
  return line;
}

/** Says something on a status line: a pending request or its outcome, or, as an alert, why it failed. */
export function say(line: HTMLElement, text: string, tone: "pending" | "done" | "error" = "done") {
  line.hidden = false;
  line.textContent = text;
  line.className = `act act-${tone}`;
  line.setAttribute("role", tone === "error" ? "alert" : "status");
}

function setDisabled(controls: HTMLElement, disabled: boolean) {
  for (const control of controls.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>("button, input, textarea")) control.disabled = disabled;
}

/**
 * A write from a view. The host gets it as a request and may ask the person first, so the controls stay disabled
 * and the line says what is pending until the result comes back. A refusal or an error is shown and the controls
 * work again; a result goes to `done`.
 */
export async function act(controls: HTMLElement, line: HTMLElement, pending: string, request: () => Promise<Outcome>, done: (value: unknown) => void) {
  setDisabled(controls, true);
  say(line, pending, "pending");
  const outcome = await request();
  if (outcome.ok) {
    done(outcome.value);
    return;
  }
  setDisabled(controls, false);
  say(line, outcome.error, "error");
}

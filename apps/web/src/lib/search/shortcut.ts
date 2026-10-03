/** An input, textarea, select or editable element, where a person types. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const editable = target.getAttribute("contenteditable");
  return (
    target.isContentEditable ||
    editable === "" ||
    editable === "true" ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Cmd+K or Ctrl+K without Alt or Shift, on every system and in text fields too. On a Mac, Ctrl+K in a
 * text field is left alone, since it deletes to the end of the line there.
 */
export function isSearchShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "target">, mac: boolean): boolean {
  if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
  return !(mac && e.ctrlKey && !e.metaKey && isTextField(e.target));
}

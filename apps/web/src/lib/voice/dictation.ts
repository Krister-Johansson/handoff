/** Input types that hold free text, where dictated words can go. */
const TEXT_TYPES = new Set(["text", "search", "url", "email", "tel"]);

export type DictationField = HTMLInputElement | HTMLTextAreaElement;

/** The text field dictation writes into: a textarea or a text input that can be edited, else nothing. */
export function dictationField(element: Element | null): DictationField | undefined {
  const field = element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && TEXT_TYPES.has(element.type)) ? element : undefined;
  return field && !field.readOnly && !field.disabled ? field : undefined;
}

/** The caret, or the end of the text where the field has no selection (an email input). */
function selection(field: DictationField): [number, number] {
  try {
    const start = field.selectionStart ?? field.value.length;
    return [start, field.selectionEnd ?? start];
  } catch {
    return [field.value.length, field.value.length];
  }
}

/**
 * Puts dictated words at the caret, replacing any selection, with a space on either side where the
 * neighbouring text needs one, and leaves the caret after them. The value is set through the
 * element's own setter and an input event follows, so a React-controlled field sees the change as
 * typing and its state keeps up.
 */
export function insertDictation(field: DictationField, text: string) {
  const words = text.trim();
  if (!words) return;
  const [start, end] = selection(field);
  const before = field.value.slice(0, start);
  const after = field.value.slice(end);
  const inserted = `${before && !/\s$/.test(before) ? " " : ""}${words}${after && !/^\s/.test(after) ? " " : ""}`;
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const next = before + inserted + after;
  if (setValue) setValue.call(field, next);
  else field.value = next;
  const caret = before.length + inserted.length;
  try {
    field.setSelectionRange(caret, caret);
  } catch {
    // An input without a selection (email) keeps the caret where the browser puts it.
  }
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * The words on the page worth recognizing reliably: project names and node keys, marked where they
 * render with `data-voice-phrase={name}`. Each phrase once, in page order.
 */
export function pagePhrases(root: ParentNode = document): string[] {
  const phrases = [...root.querySelectorAll<HTMLElement>("[data-voice-phrase]")].map((el) => (el.dataset.voicePhrase ?? "").trim());
  return [...new Set(phrases.filter(Boolean))];
}

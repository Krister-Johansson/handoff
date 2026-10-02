const MAX = 140;

/** A text cut to fit a notification: on one line, whole when it fits, otherwise cut at a word with an ellipsis. */
export function brief(text: string, max = MAX) {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, "")}…`;
}

/** What a notification says about a question: the summary its asker wrote, or the question itself, cut to fit. */
export function questionBrief(question: string, context: unknown) {
  const summary = (context as { summary?: unknown } | null)?.summary;
  return brief(typeof summary === "string" && summary.trim() ? summary : question);
}

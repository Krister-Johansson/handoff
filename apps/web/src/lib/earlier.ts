import type { DiffFile } from "@handoff/core";

/** A comment from an earlier round of the same review gate, as it was stored with the answer. */
export type EarlierComment = { path?: string; line?: number; endLine?: number; side?: "old" | "new"; quote?: string; body: string };
export type EarlierRound = { answer: string; option: string | null; comments: EarlierComment[]; answeredAt: Date | null };

/**
 * Where last round's comments on a file belong now: next to the new lines that still hold the quoted
 * code, or listed as outdated when that code is gone (or the comment quoted nothing).
 */
export function placeEarlier(file: DiffFile, comments: EarlierComment[]) {
  const lines = file.hunks.flatMap((h) => h.lines).filter((l) => l.kind !== "del");
  const anchored: { line: number; comment: EarlierComment }[] = [];
  const outdated: EarlierComment[] = [];
  for (const comment of comments.filter((c) => c.path === file.path)) {
    const quote = comment.quote?.split("\n").map((l) => l.trimEnd());
    const at = quote?.length ? lines.findIndex((_, i) => quote.every((q, k) => lines[i + k]?.text.trimEnd() === q)) : -1;
    const end = at >= 0 ? lines[at + quote!.length - 1]?.newLine : undefined;
    if (end !== undefined) anchored.push({ line: end, comment });
    else outdated.push(comment);
  }
  return { anchored, outdated };
}

/** When each file was last commented on in earlier rounds, which un-views a file marked before then. */
export function commentedAt(rounds: EarlierRound[]): Record<string, Date> {
  const at: Record<string, Date> = {};
  for (const round of rounds) {
    if (!round.answeredAt) continue;
    for (const c of round.comments) if (c.path && (!at[c.path] || at[c.path]! < round.answeredAt)) at[c.path] = round.answeredAt;
  }
  return at;
}

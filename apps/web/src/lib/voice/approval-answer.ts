const YES = /^(yes|yeah|yep|approve|approved|ok|okay|sure|go ahead|do it)\b/;
const NO = /^(no|nope|deny|denied|don't|do not|stop|cancel)\b/;

/** A spoken answer to an approval card: yes, no with the rest as the note, or neither. */
export function approvalAnswer(text: string): { approve: true } | { approve: false; note?: string } | undefined {
  const said = text.trim().toLowerCase();
  if (YES.test(said)) return { approve: true };
  const no = said.match(NO);
  if (!no) return undefined;
  const note = text.trim().slice(no[0].length).replace(/^[\s,.:;!-]+/, "").replace(/[.!?]+$/, "").trim();
  return { approve: false, ...(note ? { note } : {}) };
}

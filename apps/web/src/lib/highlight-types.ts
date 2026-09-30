/** A run of code in one colour, as the server's highlighter produced it; `style` carries light and dark colours. */
export type Token = { content: string; style?: Record<string, string> };

/** Highlighted lines of a changed file, by line number in the old and the new version. */
export type LineTokens = { old?: Record<number, Token[]>; new?: Record<number, Token[]> };

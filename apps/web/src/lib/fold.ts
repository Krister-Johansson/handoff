/** Whether Markdown is long enough to fold: more lines or characters than about `lines` lines of text. */
export const isLong = (markdown: string, lines: number) => markdown.split("\n").filter((l) => l.trim()).length > lines || markdown.length > lines * 90;

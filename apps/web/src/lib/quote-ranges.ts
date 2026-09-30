/**
 * Ranges in `root` whose text is `quote`, comparing with runs of whitespace collapsed, since a
 * selection's text and the DOM's text differ in whitespace between elements.
 */
export function quoteRanges(root: Node, quote: string): Range[] {
  const needle = quote.replace(/\s+/g, " ").trim();
  if (!needle) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // The collapsed text, and for each of its characters the text node and offset it came from.
  let text = "";
  const at: { node: Text; offset: number }[] = [];
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    for (let i = 0; i < node.data.length; i++) {
      const char = /\s/.test(node.data[i]!) ? " " : node.data[i]!;
      if (char === " " && text.endsWith(" ")) continue;
      text += char;
      at.push({ node, offset: i });
    }
    if (!text.endsWith(" ")) {
      text += " ";
      at.push({ node, offset: node.data.length });
    }
  }
  const ranges: Range[] = [];
  for (let from = text.indexOf(needle); from !== -1; from = text.indexOf(needle, from + 1)) {
    const start = at[from]!;
    const end = at[from + needle.length - 1]!;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, Math.min(end.offset + 1, end.node.data.length));
    ranges.push(range);
  }
  return ranges;
}
